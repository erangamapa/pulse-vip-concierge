import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ModelRouter, DEFAULT_ROUTER_POLICY, providersFromEnv } from 'agentloop';
import { webhookCallback } from 'grammy';
import { InMemoryAuditLog } from './audit.js';
import { createBot } from './bot.js';
import { createConciergeAgent } from './conciergeAgent.js';
import { loadConfig } from './config.js';
import { createConversation } from './conversation.js';
import { bettingFlow } from './flows/betting.js';
import { dealsFlow } from './flows/deals.js';
import { limitsFlow } from './flows/limits.js';
import { createHttpLoyaltyClient, createHttpPlacementHandoff, createHttpTradingClient } from './http-clients.js';
import { InMemoryBindingStore } from './identity.js';
import { FIXTURE_DOCS, InMemoryKnowledgeStore } from './knowledge/store.js';
import { SIGNATURE_HEADER, createNotifier, decisionPayload, verifySignature } from './notify.js';

const MAX_BODY_BYTES = 64 * 1024;

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const respond = (response: ServerResponse, status: number, body = ''): void => {
  response.writeHead(status, { 'content-type': 'text/plain' }).end(body);
};

const main = (): void => {
  const config = loadConfig(process.env);

  const loyalty = createHttpLoyaltyClient({ baseUrl: config.LOYALTY_API_URL, token: config.LOYALTY_API_TOKEN });
  const trading = createHttpTradingClient({ baseUrl: config.TRADING_API_URL, token: config.TRADING_API_TOKEN });
  const placement = createHttpPlacementHandoff({
    baseUrl: config.PLACEMENT_QUEUE_URL,
    token: config.PLACEMENT_QUEUE_TOKEN,
  });

  const audit = new InMemoryAuditLog();
  // TODO swap for a Postgres backed store so bindings and the audit trail survive a restart.
  const bindings = new InMemoryBindingStore({
    seed: config.bindings.map((binding) => ({ ...binding, verifiedAt: new Date().toISOString() })),
  });
  const knowledge = new InMemoryKnowledgeStore(FIXTURE_DOCS, async (customerId) => (await loyalty.getTier(customerId)).level);

  const router = new ModelRouter(DEFAULT_ROUTER_POLICY, providersFromEnv(process.env));
  const harness = createConciergeAgent({ router, loyalty, trading, knowledge, placement, audit });
  const conversation = createConversation({ harness, flows: [limitsFlow, dealsFlow, bettingFlow], audit });

  const bot = createBot({
    token: config.TELEGRAM_BOT_TOKEN,
    bindings,
    audit,
    conversation,
    onError: (error) => console.error('update failed', error),
  });
  const notifier = createNotifier({
    bindings,
    audit,
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId, text);
    },
  });

  const telegramHandler = webhookCallback(bot, 'http', { secretToken: config.TELEGRAM_WEBHOOK_SECRET });

  const server = createServer((request, response) => {
    const route = `${request.method} ${request.url}`;
    const handle = async (): Promise<void> => {
      if (route === 'GET /healthz') return respond(response, 200, 'ok');
      if (route === 'POST /telegram') return telegramHandler(request, response);
      if (route === 'POST /webhooks/manager-decision') {
        const raw = await readBody(request);
        const signature = request.headers[SIGNATURE_HEADER];
        if (!verifySignature(config.MANAGER_WEBHOOK_SECRET, raw, typeof signature === 'string' ? signature : undefined)) {
          return respond(response, 401);
        }
        const parsed = decisionPayload.safeParse(JSON.parse(raw));
        if (!parsed.success) return respond(response, 400);
        const delivery = await notifier.handle(parsed.data);
        return respond(response, delivery === 'delivered' ? 202 : 404);
      }
      return respond(response, 404);
    };
    handle().catch((error: unknown) => {
      console.error('request failed', error);
      if (!response.headersSent) respond(response, 500);
    });
  });

  server.listen(config.PORT, () => console.log(`listening on ${config.PORT}`));

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

main();
