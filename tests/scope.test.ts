import { defineTool } from 'agentloop';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuthorityToolError, createConciergeRegistry, createConciergeTools } from '../src/conciergeAgent.js';
import { InMemoryPlacementHandoff } from '../src/flows/betting.js';
import { InMemoryAuditLog } from '../src/audit.js';
import { FakeKnowledgeStore, FakeLoyaltyClient, FakeTradingClient } from './support/fakes.js';

const deps = () => ({
  loyalty: new FakeLoyaltyClient({}),
  trading: new FakeTradingClient(),
  knowledge: new FakeKnowledgeStore([]),
  placement: new InMemoryPlacementHandoff(),
  audit: new InMemoryAuditLog(),
});

const authorityTool = (name: string) =>
  defineTool({
    name,
    description: 'Not allowed here.',
    schema: z.object({ slipId: z.string() }),
    scope: ['concierge'],
    handler: () => 'done',
  });

describe('concierge tool scope', () => {
  it('wires exactly the request side tools', () => {
    const registry = createConciergeRegistry(createConciergeTools(deps()));
    expect(
      registry
        .for('concierge')
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['fileLimitRequest', 'getBenefits', 'getOdds', 'getTier', 'listLimitRequests', 'proposeBet', 'proposeDeal']);
  });

  it.each(['placeBet', 'approveLimitRequest', 'setLimits', 'cancelBet'])(
    'throws at construction when %s is wired in',
    (name) => {
      expect(() => createConciergeRegistry([...createConciergeTools(deps()), authorityTool(name)])).toThrow(
        AuthorityToolError,
      );
    },
  );

  it('keeps the odds tool volatile so stale prices are pruned', () => {
    const registry = createConciergeRegistry(createConciergeTools(deps()));
    expect([...registry.volatileNames()]).toEqual(['getOdds']);
  });
});
