import type { TierLevel } from 'sportsbook-contracts';

export interface KnowledgeDoc {
  id: string;
  title: string;
  body: string;
  /** A doc is either written for exactly one tier or applies to everyone. */
  tier: TierLevel | 'all';
}

export interface KnowledgeStore {
  retrieve(customerId: string, query: string, limit?: number): Promise<KnowledgeDoc[]>;
}

export type TierLookup = (customerId: string) => Promise<TierLevel>;

const DEFAULT_LIMIT = 3;

const tokensOf = (text: string): string[] => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const scoreDoc = (queryTokens: readonly string[], doc: KnowledgeDoc): number => {
  const haystack = new Set(tokensOf(`${doc.title} ${doc.body}`));
  return queryTokens.filter((token) => haystack.has(token)).length;
};

/**
 * The tier filter runs before ranking and is the only gate on what comes back.
 * The model supplies a query string and nothing else, so it cannot ask for
 * another tier's terms.
 *
 * A pgvector store would keep the same contract. It would put the tier
 * predicate in the where clause of a single query that orders rows by cosine
 * distance to the query embedding, so rows from other tiers are never fetched.
 */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  constructor(
    private readonly docs: readonly KnowledgeDoc[],
    private readonly tierOf: TierLookup,
  ) {}

  async retrieve(customerId: string, query: string, limit = DEFAULT_LIMIT): Promise<KnowledgeDoc[]> {
    const level = await this.tierOf(customerId);
    const queryTokens = tokensOf(query);
    return this.docs
      .filter((doc) => doc.tier === 'all' || doc.tier === level)
      .map((doc) => ({ doc, score: scoreDoc(queryTokens, doc) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ doc }) => doc);
  }
}

export const FIXTURE_DOCS: readonly KnowledgeDoc[] = [
  {
    id: 'all-limit-requests',
    title: 'How limit change requests work',
    body: 'You can ask for a higher max stake for a single event or a window of days. Your account manager reviews every request and decides. A request is never approved on the spot.',
    tier: 'all',
  },
  {
    id: 'all-custom-deals',
    title: 'Custom deals',
    body: 'Special offers are proposed to your account manager with the event they relate to. Terms apply only after the manager approves them in writing.',
    tier: 'all',
  },
  {
    id: 'silver-benefits',
    title: 'Silver tier benefits',
    body: 'Silver members get 2 percent weekly cashback and a reviewed max stake of up to 1000 per bet.',
    tier: 'silver',
  },
  {
    id: 'gold-benefits',
    title: 'Gold tier benefits',
    body: 'Gold members get 5 percent weekly cashback, priority withdrawals and a reviewed max stake of up to 5000 per bet. Limit requests are answered within one business day.',
    tier: 'gold',
  },
  {
    id: 'platinum-benefits',
    title: 'Platinum tier benefits',
    body: 'Platinum members get 8 percent weekly cashback, a named account manager and a reviewed max stake of up to 15000 per bet.',
    tier: 'platinum',
  },
  {
    id: 'diamond-benefits',
    title: 'Diamond tier benefits',
    body: 'Diamond members get 12 percent weekly cashback, bespoke limits agreed per event and a reviewed max stake above 50000 per bet. Limit requests are answered within two hours.',
    tier: 'diamond',
  },
];
