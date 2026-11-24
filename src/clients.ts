import type {
  Benefit,
  CreateDeal,
  CreateLimitRequest,
  Deal,
  LimitRequest,
  OddsTick,
  PlaceBetRequest,
  PricedSlip,
  SlipDraft,
  Tier,
} from 'sportsbook-contracts';

export interface LoyaltyClient {
  getTier(customerId: string): Promise<Tier>;
  getBenefits(customerId: string): Promise<Benefit[]>;
  listLimitRequests(customerId: string): Promise<LimitRequest[]>;
  createLimitRequest(
    customerId: string,
    body: CreateLimitRequest,
    idempotencyKey: string,
  ): Promise<LimitRequest>;
  createDeal(customerId: string, body: CreateDeal, idempotencyKey: string): Promise<Deal>;
}

export interface TradingClient {
  getOdds(eventId: string, marketId?: string): Promise<OddsTick[]>;
  priceSlip(draft: SlipDraft): Promise<PricedSlip>;
}

export interface PlacementRequest extends PlaceBetRequest {
  customerId: string;
  idempotencyKey: string;
}

/** The placement queue is owned by pulse-agents. This service only hands a confirmed bet over. */
export interface PlacementHandoff {
  enqueue(request: PlacementRequest): Promise<{ queueId: string }>;
}
