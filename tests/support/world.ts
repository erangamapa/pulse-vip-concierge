import type { AIMessage } from '@langchain/core/messages';
import { DEFAULT_ROUTER_POLICY, ModelRouter } from 'agentloop';
import type { Update, UserFromGetMe } from 'grammy/types';
import type { Benefit, TierLevel } from 'sportsbook-contracts';
import { InMemoryAuditLog } from '../../src/audit.js';
import { createBot } from '../../src/bot.js';
import { createConciergeAgent } from '../../src/conciergeAgent.js';
import { createConversation } from '../../src/conversation.js';
import { bettingFlow, InMemoryPlacementHandoff } from '../../src/flows/betting.js';
import { dealsFlow } from '../../src/flows/deals.js';
import { limitsFlow } from '../../src/flows/limits.js';
import { InMemoryBindingStore } from '../../src/identity.js';
import { FIXTURE_DOCS, InMemoryKnowledgeStore } from '../../src/knowledge/store.js';
import { createNotifier } from '../../src/notify.js';
import { FakeLoyaltyClient, FakeTradingClient } from './fakes.js';
import { ScriptedModel } from './scripted-model.js';

const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'Concierge',
  username: 'concierge_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
} as UserFromGetMe;

export const GOLD_CHAT = 1001;
export const GOLD_CUSTOMER = 'cust_1001';
export const STRANGER_CHAT = 9999;

export interface SentMessage {
  method: string;
  chatId: number;
  text: string;
  buttons: string[];
  callbackData: string[];
}

export interface WorldOptions {
  script: readonly AIMessage[];
  benefits?: readonly Benefit[];
  tiers?: Readonly<Record<string, TierLevel>>;
}

let updateCounter = 0;

const person = (chatId: number) => ({ id: chatId, is_bot: false, first_name: 'Vip' });
const chatOf = (chatId: number, type: 'private' | 'group' = 'private') =>
  type === 'private' ? { id: chatId, type, first_name: 'Vip' } : { id: chatId, type, title: 'Room' };

export const textUpdate = (chatId: number, text: string, type: 'private' | 'group' = 'private'): Update => {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    message: { message_id: updateCounter, date: 1_780_000_000, chat: chatOf(chatId, type), from: person(chatId), text },
  };
};

export const photoUpdate = (chatId: number): Update => {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    message: {
      message_id: updateCounter,
      date: 1_780_000_000,
      chat: chatOf(chatId),
      from: person(chatId),
      photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }],
    },
  };
};

export const callbackUpdate = (chatId: number, data: string): Update => {
  updateCounter += 1;
  return {
    update_id: updateCounter,
    callback_query: {
      id: `cb_${updateCounter}`,
      from: person(chatId),
      chat_instance: 'ci',
      data,
      message: { message_id: updateCounter, date: 1_780_000_000, chat: chatOf(chatId), text: 'card' },
    },
  };
};

export const createWorld = (options: WorldOptions) => {
  const model = new ScriptedModel(options.script);
  const router = new ModelRouter(DEFAULT_ROUTER_POLICY, { open: () => model, cheap: () => model, strong: () => model });
  const tiers = options.tiers ?? { [GOLD_CUSTOMER]: 'gold' };
  const loyalty = new FakeLoyaltyClient(tiers, options.benefits);
  const trading = new FakeTradingClient();
  const placement = new InMemoryPlacementHandoff();
  const audit = new InMemoryAuditLog(() => new Date('2026-06-01T10:00:00.000Z'));
  const bindings = new InMemoryBindingStore({
    seed: [{ chatId: GOLD_CHAT, customerId: GOLD_CUSTOMER, verifiedAt: '2026-05-01T00:00:00.000Z' }],
  });
  const knowledge = new InMemoryKnowledgeStore(FIXTURE_DOCS, async (customerId) => (await loyalty.getTier(customerId)).level);

  const harness = createConciergeAgent({ router, loyalty, trading, knowledge, placement, audit });
  const conversation = createConversation({
    harness,
    flows: [limitsFlow, dealsFlow, bettingFlow],
    audit,
    newToken: () => 'tok',
    newConfirmationRef: () => 'cnf_test',
  });

  const bot = createBot({
    token: 'test-token',
    bindings,
    audit,
    conversation,
    botConfig: { botInfo: BOT_INFO },
  });

  const sent: SentMessage[] = [];
  bot.api.config.use(async (_previous, method, payload) => {
    const body = payload as {
      chat_id?: number;
      text?: string;
      reply_markup?: { inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>> };
    };
    const keys = (body.reply_markup?.inline_keyboard ?? []).flat();
    sent.push({
      method,
      chatId: body.chat_id ?? 0,
      text: body.text ?? '',
      buttons: keys.map((key) => key.text),
      callbackData: keys.flatMap((key) => (key.callback_data ? [key.callback_data] : [])),
    });
    return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: body.chat_id ?? 0, type: 'private' }, text: body.text } : true } as never;
  });

  const notifier = createNotifier({
    bindings,
    audit,
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId, text);
    },
  });

  const texts = (): SentMessage[] => sent.filter((message) => message.method === 'sendMessage');

  return {
    model,
    loyalty,
    trading,
    placement,
    audit,
    bindings,
    notifier,
    sent,
    texts,
    lastText: (): SentMessage => {
      const last = texts().at(-1);
      if (!last) throw new Error('Nothing was sent.');
      return last;
    },
    send: (chatId: number, text: string) => bot.handleUpdate(textUpdate(chatId, text)),
    press: (chatId: number, data: string) => bot.handleUpdate(callbackUpdate(chatId, data)),
    handle: (update: Update) => bot.handleUpdate(update),
  };
};
