import { z } from 'zod';
import {
  benefit,
  deal,
  limitRequest,
  oddsTick,
  pricedSlip,
  tier,
  type CreateDeal,
  type CreateLimitRequest,
  type SlipDraft,
} from 'sportsbook-contracts';
import type { LoyaltyClient, PlacementHandoff, PlacementRequest, TradingClient } from './clients.js';

export class UpstreamError extends Error {
  override readonly name = 'UpstreamError';

  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Upstream call to ${path} failed with status ${status}.`);
  }
}

export interface HttpOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

const caller = ({ baseUrl, token, fetchFn = fetch }: HttpOptions) =>
  async <S extends z.ZodTypeAny>(
    schema: S,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<z.infer<S>> => {
    const response = await fetchFn(new URL(path, baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) throw new UpstreamError(response.status, path);
    return schema.parse(await response.json());
  };

export const createHttpLoyaltyClient = (options: HttpOptions): LoyaltyClient => {
  const call = caller(options);
  const base = (customerId: string): string => `/customers/${encodeURIComponent(customerId)}`;
  return {
    getTier: (customerId) => call(tier, 'GET', `${base(customerId)}/tier`),
    getBenefits: (customerId) => call(z.array(benefit), 'GET', `${base(customerId)}/benefits`),
    listLimitRequests: (customerId) => call(z.array(limitRequest), 'GET', `${base(customerId)}/limit-requests`),
    createLimitRequest: (customerId: string, body: CreateLimitRequest, idempotencyKey: string) =>
      call(limitRequest, 'POST', `${base(customerId)}/limit-requests`, { body, idempotencyKey }),
    createDeal: (customerId: string, body: CreateDeal, idempotencyKey: string) =>
      call(deal, 'POST', `${base(customerId)}/deals`, { body, idempotencyKey }),
  };
};

export const createHttpTradingClient = (options: HttpOptions): TradingClient => {
  const call = caller(options);
  return {
    getOdds: (eventId, marketId) => {
      const query = marketId ? `?marketId=${encodeURIComponent(marketId)}` : '';
      return call(z.array(oddsTick), 'GET', `/events/${encodeURIComponent(eventId)}/odds${query}`);
    },
    priceSlip: (draft: SlipDraft) => call(pricedSlip, 'POST', '/slips/price', { body: draft }),
  };
};

export const createHttpPlacementHandoff = (options: HttpOptions): PlacementHandoff => {
  const call = caller(options);
  return {
    enqueue: (request: PlacementRequest) =>
      call(z.object({ queueId: z.string().min(1) }), 'POST', '/placements', {
        body: request,
        idempotencyKey: request.idempotencyKey,
      }),
  };
};
