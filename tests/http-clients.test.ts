import { describe, expect, it } from 'vitest';
import { UpstreamError, createHttpLoyaltyClient } from '../src/http-clients.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('http loyalty client', () => {
  it('sends the token and idempotency key and validates the response', async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return json({
        requestId: 'lr_1',
        customerId: 'cust_1',
        status: 'pending',
        kind: 'dailyCap',
        requestedValue: { currency: 'USD', amount: '100' },
        reason: 'r',
        createdAt: '2026-06-01T10:00:00.000Z',
      });
    };
    const client = createHttpLoyaltyClient({ baseUrl: 'https://loyalty.sportsbook.internal', token: 't0k', fetchFn });

    const created = await client.createLimitRequest(
      'cust_1',
      { kind: 'dailyCap', requestedValue: { currency: 'USD', amount: '100' }, reason: 'r' },
      'key-1',
    );

    expect(created.requestId).toBe('lr_1');
    expect(seen[0]?.url).toBe('https://loyalty.sportsbook.internal/customers/cust_1/limit-requests');
    expect(seen[0]?.init?.headers).toMatchObject({ authorization: 'Bearer t0k', 'idempotency-key': 'key-1' });
  });

  it('throws a typed error on a failed call and on a malformed body', async () => {
    const failing = createHttpLoyaltyClient({
      baseUrl: 'https://loyalty.sportsbook.internal',
      token: 't',
      fetchFn: async () => json({}, 503),
    });
    await expect(failing.getTier('cust_1')).rejects.toBeInstanceOf(UpstreamError);

    const malformed = createHttpLoyaltyClient({
      baseUrl: 'https://loyalty.sportsbook.internal',
      token: 't',
      fetchFn: async () => json({ level: 'platinum-plus' }),
    });
    await expect(malformed.getTier('cust_1')).rejects.toThrow();
  });
});
