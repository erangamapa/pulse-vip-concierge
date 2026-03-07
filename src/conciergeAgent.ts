import {
  ToolRegistry,
  createHarness,
  defineTool,
  type Harness,
  type ModelRouter,
  type ToolContext,
  type ToolDefinition,
} from 'agentloop';
import { tierLevel } from 'sportsbook-contracts';
import type { z } from 'zod';
import type { AuditLog } from './audit.js';
import type { LoyaltyClient, PlacementHandoff, TradingClient } from './clients.js';
import type { KnowledgeStore } from './knowledge/store.js';
import {
  fileLimitRequestParams,
  getBenefitsParams,
  getOddsParams,
  getTierParams,
  listLimitRequestsParams,
  proposeBetParams,
  proposeDealParams,
} from './schemas.js';

export const CONCIERGE_ROLE = 'concierge';
export const CONCIERGE_AGENT_ID = 'concierge';
export const PROMPT_VERSION = 'concierge-1';

export const SYSTEM_PROMPT = [
  'You are the private concierge for a high value customer of a sportsbook. You talk to one customer in a private chat.',
  'You can answer questions about their tier and benefits, file limit change requests, propose custom deals and propose bets.',
  'You can request anything and approve nothing. Every limit change and every deal is decided by a human account manager. Never say or imply that something is approved unless a tool result says so.',
  'Before you file a limit request, collect the kind of limit, the value with its currency, the reason and the event it is for. Ask for whatever is missing, one short question at a time.',
  'Filing a request, proposing a deal and proposing a bet each show the customer a confirmation card. Do not ask for confirmation in text. Call the tool and the card does the asking.',
  'Odds change quickly. Call getOdds again before you propose a bet and never reuse a price from an earlier turn.',
  'Answer benefit questions only from tool results. If a tool does not return an answer, say you will check with the account manager.',
  'Keep replies short and plain.',
].join('\n');

/**
 * Anything that sounds like authority over money or limits is refused when the
 * registry is built. The concierge can only ask, so there is nothing to wire.
 */
const AUTHORITY_VERB = /^(place|approve|decline|decide|set|raise|cancel|settle|grant|override|withdraw)/i;

export class AuthorityToolError extends Error {
  override readonly name = 'AuthorityToolError';

  constructor(readonly toolName: string) {
    super(`Tool "${toolName}" carries authority the concierge must not hold.`);
  }
}

export const createConciergeRegistry = (tools: readonly ToolDefinition[]): ToolRegistry => {
  const offender = tools.find((tool) => AUTHORITY_VERB.test(tool.name));
  if (offender) throw new AuthorityToolError(offender.name);
  return new ToolRegistry(tools);
};

export interface ConciergeDeps {
  loyalty: LoyaltyClient;
  trading: TradingClient;
  knowledge: KnowledgeStore;
  placement: PlacementHandoff;
  audit: AuditLog;
}

const levelRank = (level: string): number => tierLevel.options.indexOf(level as never);

const requireKey = (context: ToolContext): string => {
  if (!context.idempotencyKey) throw new Error('Idempotency key missing for a write.');
  return context.idempotencyKey;
};

const filedBy = { kind: 'agent', id: CONCIERGE_AGENT_ID } as const;

const money = (value: { currency: string; amount: string }): string => `${value.currency} ${value.amount}`;

export const createConciergeTools = (deps: ConciergeDeps): ToolDefinition[] => {
  const { loyalty, trading, knowledge, placement, audit } = deps;

  const conciergeTool = <S extends z.AnyZodObject>(spec: {
    name: string;
    description: string;
    schema: S;
    volatile?: boolean;
    needsIdempotencyKey?: boolean;
    gate?: { kind: 'money' | 'irreversible'; summary: (params: z.infer<S>) => string };
    handler: (params: z.infer<S>, context: ToolContext) => Promise<object>;
  }): ToolDefinition => {
    const { handler, ...rest } = spec;
    return defineTool({
      ...rest,
      scope: [CONCIERGE_ROLE],
      handler: async (params: z.infer<S>, context: ToolContext) => {
        const base = { kind: 'tool', threadId: context.threadId, customerId: context.sessionUserId } as const;
        try {
          const result = await handler(params, context);
          await audit.append({
            ...base,
            detail: {
              tool: spec.name,
              outcome: 'ok',
              toolCallId: context.toolCallId,
              ...(context.confirmationRef ? { confirmationRef: context.confirmationRef } : {}),
              result,
            },
          });
          return result;
        } catch (error) {
          await audit.append({
            ...base,
            detail: {
              tool: spec.name,
              outcome: 'error',
              toolCallId: context.toolCallId,
              message: error instanceof Error ? error.message : 'unknown failure',
            },
          });
          throw error;
        }
      },
    });
  };

  return [
    conciergeTool({
      name: 'getTier',
      description: 'Returns the customer tier, cashback rate, progress to the next tier and the account manager handle.',
      schema: getTierParams,
      handler: async (_params, context) => {
        const tier = await loyalty.getTier(context.sessionUserId);
        return {
          level: tier.level,
          cashbackPct: tier.cashbackPct,
          progress: tier.progress,
          managerHandle: tier.managerHandle,
        };
      },
    }),
    conciergeTool({
      name: 'getBenefits',
      description:
        'Returns the benefits for the customer tier and, when a topic is given, the matching program terms. Only this customer tier is ever returned.',
      schema: getBenefitsParams,
      handler: async (params, context) => {
        const { level } = await loyalty.getTier(context.sessionUserId);
        const all = await loyalty.getBenefits(context.sessionUserId);
        const benefits = all
          .filter((benefit) => !benefit.minLevel || levelRank(benefit.minLevel) <= levelRank(level))
          .map(({ name, description }) => ({ name, description }));
        const docs = params.topic ? await knowledge.retrieve(context.sessionUserId, params.topic) : [];
        return { level, benefits, terms: docs.map(({ title, body }) => ({ title, body })) };
      },
    }),
    conciergeTool({
      name: 'listLimitRequests',
      description: 'Lists the limit change requests this customer has filed and their current status.',
      schema: listLimitRequestsParams,
      handler: async (_params, context) => {
        const requests = await loyalty.listLimitRequests(context.sessionUserId);
        return {
          requests: requests.map((request) => ({
            requestId: request.requestId,
            kind: request.kind,
            requestedValue: request.requestedValue,
            eventContext: request.eventContext,
            status: request.status,
          })),
        };
      },
    }),
    conciergeTool({
      name: 'fileLimitRequest',
      description:
        'Files a limit change request for the account manager to decide. The customer confirms the wording first. The result is always pending.',
      schema: fileLimitRequestParams,
      needsIdempotencyKey: true,
      gate: {
        kind: 'irreversible',
        summary: (params) => `File a ${params.kind} request for ${money(params.requestedValue)}.`,
      },
      handler: async (params, context) => {
        const request = await loyalty.createLimitRequest(
          context.sessionUserId,
          { ...params, filedBy },
          requireKey(context),
        );
        return { requestId: request.requestId, status: request.status };
      },
    }),
    conciergeTool({
      name: 'proposeDeal',
      description:
        'Proposes a custom deal to the account manager. The customer confirms the wording first. Terms apply only after a human approves.',
      schema: proposeDealParams,
      needsIdempotencyKey: true,
      gate: { kind: 'irreversible', summary: (params) => `Propose a deal. ${params.summary}` },
      handler: async (params, context) => {
        const deal = await loyalty.createDeal(context.sessionUserId, { ...params, filedBy }, requireKey(context));
        return { dealId: deal.dealId, status: deal.status };
      },
    }),
    conciergeTool({
      name: 'getOdds',
      description: 'Returns current prices for an event, optionally narrowed to one market.',
      schema: getOddsParams,
      volatile: true,
      handler: async (params) => {
        const ticks = await trading.getOdds(params.eventId, params.marketId);
        return { ticks: ticks.map(({ marketId, selectionId, price, status }) => ({ marketId, selectionId, price, status })) };
      },
    }),
    conciergeTool({
      name: 'proposeBet',
      description:
        'Proposes a bet. The customer sees a card and must confirm. After confirmation the bet is handed to the placement queue. This tool never places a bet itself.',
      schema: proposeBetParams,
      needsIdempotencyKey: true,
      gate: {
        kind: 'money',
        summary: (params) => `Bet ${money(params.stake)} on ${params.selections.length} selection(s).`,
      },
      handler: async (params, context) => {
        const { confirmationRef } = context;
        if (!confirmationRef) throw new Error('A bet cannot move without a confirmation reference.');

        const priced = await trading.priceSlip({ ...params, accountId: context.sessionUserId });
        const drifted = priced.selections.some((selection) => selection.repriced || selection.status === 'suspended');
        if (!priced.valid || drifted) {
          const reasons = priced.rejections.length > 0 ? priced.rejections : ['The price moved before confirmation.'];
          return { status: 'rejected', reasons };
        }

        const { queueId } = await placement.enqueue({
          slipId: priced.slipId,
          stake: params.stake,
          placedBy: filedBy,
          onBehalfOf: context.sessionUserId,
          confirmationRef,
          customerId: context.sessionUserId,
          idempotencyKey: requireKey(context),
        });
        return { status: 'handed_off', confirmationRef, queueId };
      },
    }),
  ];
};

export interface ConciergeAgentConfig extends ConciergeDeps {
  router: ModelRouter;
}

export const createConciergeAgent = ({ router, ...deps }: ConciergeAgentConfig): Harness =>
  createHarness({
    role: CONCIERGE_ROLE,
    registry: createConciergeRegistry(createConciergeTools(deps)),
    router,
    systemPrompt: SYSTEM_PROMPT,
    promptVersion: PROMPT_VERSION,
  });
