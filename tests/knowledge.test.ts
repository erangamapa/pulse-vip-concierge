import { describe, expect, it } from 'vitest';
import { InMemoryAuditLog } from '../src/audit.js';
import { createConciergeRegistry, createConciergeTools } from '../src/conciergeAgent.js';
import { InMemoryPlacementHandoff } from '../src/flows/betting.js';
import { FIXTURE_DOCS, InMemoryKnowledgeStore } from '../src/knowledge/store.js';
import { FakeLoyaltyClient, FakeTradingClient } from './support/fakes.js';

const tiers = { cust_gold: 'gold', cust_diamond: 'diamond' } as const;
const lookup = (customerId: string) => {
  const level = tiers[customerId as keyof typeof tiers];
  if (!level) throw new Error('unknown customer');
  return Promise.resolve(level);
};

describe('tier scoped retrieval', () => {
  const store = new InMemoryKnowledgeStore(FIXTURE_DOCS, lookup);

  it('never returns diamond docs to a gold customer, whatever the query says', async () => {
    const queries = ['diamond tier benefits', 'bespoke limits above 50000', 'cashback max stake', 'limit requests two hours'];
    for (const query of queries) {
      const docs = await store.retrieve('cust_gold', query, 10);
      expect(docs.map((doc) => doc.tier)).not.toContain('diamond');
      expect(docs.map((doc) => doc.body).join(' ')).not.toContain('50000');
    }
  });

  it('returns gold terms and shared docs to gold', async () => {
    const docs = await store.retrieve('cust_gold', 'cashback max stake limit requests', 10);
    expect(docs.map((doc) => doc.id)).toEqual(expect.arrayContaining(['gold-benefits', 'all-limit-requests']));
  });

  it('returns diamond terms to a diamond customer and not gold terms', async () => {
    const docs = await store.retrieve('cust_diamond', 'cashback max stake', 10);
    expect(docs.map((doc) => doc.id)).toContain('diamond-benefits');
    expect(docs.map((doc) => doc.tier)).not.toContain('gold');
  });

  it('returns nothing when the query matches no word', async () => {
    expect(await store.retrieve('cust_gold', 'zzz', 5)).toEqual([]);
  });

  it('keeps the getBenefits tool inside the customer tier', async () => {
    const loyalty = new FakeLoyaltyClient(tiers, [
      { benefitId: 'b1', name: 'Priority withdrawals', minLevel: 'gold' },
      { benefitId: 'b2', name: 'Bespoke event limits', minLevel: 'diamond' },
      { benefitId: 'b3', name: 'Weekly cashback' },
    ]);
    const registry = createConciergeRegistry(
      createConciergeTools({
        loyalty,
        trading: new FakeTradingClient(),
        knowledge: store,
        placement: new InMemoryPlacementHandoff(),
        audit: new InMemoryAuditLog(),
      }),
    );

    const tool = registry.get('getBenefits');
    const result = await tool.handler(
      { topic: 'cashback max stake limit' },
      { sessionUserId: 'cust_gold', threadId: 't', toolCallId: 'c' },
    );
    const text = JSON.stringify(result);
    expect(text).toContain('Priority withdrawals');
    expect(text).toContain('Weekly cashback');
    expect(text).not.toContain('Bespoke');
    expect(text).not.toContain('50000');
  });
});
