import type {
  Benefit,
  CreateDeal,
  CreateLimitRequest,
  Deal,
  LimitRequest,
  OddsTick,
  PricedSlip,
  SlipDraft,
  Tier,
  TierLevel,
} from 'sportsbook-contracts';
import type { LoyaltyClient, TradingClient } from '../../src/clients.js';
import type { KnowledgeDoc, KnowledgeStore } from '../../src/knowledge/store.js';

export class FakeLoyaltyClient implements LoyaltyClient {
  readonly limitRequests: LimitRequest[] = [];
  readonly deals: Deal[] = [];
  readonly keys: string[] = [];

  constructor(
    private readonly tiers: Readonly<Record<string, TierLevel>>,
    private readonly benefits: readonly Benefit[] = [],
  ) {}

  async getTier(customerId: string): Promise<Tier> {
    const level = this.tiers[customerId];
    if (!level) throw new Error(`No tier for ${customerId}.`);
    return { customerId, level, cashbackPct: 5, managerHandle: 'mgr_7' };
  }

  async getBenefits(): Promise<Benefit[]> {
    return [...this.benefits];
  }

  async listLimitRequests(customerId: string): Promise<LimitRequest[]> {
    return this.limitRequests.filter((request) => request.customerId === customerId);
  }

  async createLimitRequest(customerId: string, body: CreateLimitRequest, key: string): Promise<LimitRequest> {
    this.keys.push(key);
    const request: LimitRequest = {
      ...body,
      requestId: `lr_${this.limitRequests.length + 1}`,
      customerId,
      status: 'pending',
      createdAt: '2026-06-01T10:00:00.000Z',
    };
    this.limitRequests.push(request);
    return request;
  }

  async createDeal(customerId: string, body: CreateDeal, key: string): Promise<Deal> {
    this.keys.push(key);
    const deal: Deal = {
      ...body,
      dealId: `deal_${this.deals.length + 1}`,
      customerId,
      status: 'proposed',
      createdAt: '2026-06-01T10:00:00.000Z',
    };
    this.deals.push(deal);
    return deal;
  }
}

export class FakeTradingClient implements TradingClient {
  repriced = false;

  async getOdds(eventId: string, marketId = 'm1'): Promise<OddsTick[]> {
    return [
      { eventId, marketId, selectionId: 's1', price: '2.1', status: 'active', seq: 1, ts: '2026-06-01T10:00:00.000Z' },
    ];
  }

  async priceSlip(draft: SlipDraft): Promise<PricedSlip> {
    return {
      slipId: 'slip_1',
      selections: draft.selections.map((selection) => ({ ...selection, status: 'active', repriced: this.repriced })),
      stake: draft.stake,
      potentialReturn: { currency: draft.stake.currency, amount: '210' },
      valid: true,
      rejections: [],
    };
  }
}

export class FakeKnowledgeStore implements KnowledgeStore {
  readonly queries: Array<{ customerId: string; query: string }> = [];

  constructor(private readonly docs: readonly KnowledgeDoc[]) {}

  async retrieve(customerId: string, query: string): Promise<KnowledgeDoc[]> {
    this.queries.push({ customerId, query });
    return [...this.docs];
  }
}
