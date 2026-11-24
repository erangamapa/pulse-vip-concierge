import { describe, expect, it } from 'vitest';
import { finalAnswer, toolCall } from './support/scripted-model.js';
import { GOLD_CHAT, GOLD_CUSTOMER, createWorld } from './support/world.js';

describe('audit trail', () => {
  it('records a full limit flow completely and in order', async () => {
    const world = createWorld({
      script: [
        finalAnswer('Which value?'),
        toolCall('c1', 'fileLimitRequest', {
          kind: 'maxStakePerBet',
          requestedValue: { currency: 'USD', amount: '25000' },
          reason: 'Final week, contact me on fan@example.com',
        }),
        finalAnswer('done'),
      ],
    });

    await world.send(GOLD_CHAT, 'bigger limit please');
    await world.send(GOLD_CHAT, 'USD 25000');
    await world.press(GOLD_CHAT, 'c:tok:y');

    const trail = world.audit.entries();
    expect(trail.map((entry) => (entry.kind === 'tool' ? `tool:${String(entry.detail['tool'])}` : entry.kind))).toEqual([
      'inbound',
      'outbound',
      'inbound',
      'outbound',
      'inbound',
      'tool:fileLimitRequest',
      'outbound',
    ]);
    expect(trail.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(trail.every((entry) => entry.customerId === GOLD_CUSTOMER)).toBe(true);
    expect(trail.every((entry) => entry.threadId === `tg-${GOLD_CHAT}`)).toBe(true);
    expect(trail[4]?.detail).toMatchObject({ type: 'callback_query', data: 'c:tok:y' });
    expect(trail[5]?.detail).toMatchObject({ outcome: 'ok', result: { requestId: 'lr_1', status: 'pending' } });
  });

  it('masks personal data in inbound text', async () => {
    const world = createWorld({ script: [finalAnswer('ok')] });
    await world.send(GOLD_CHAT, 'mail me at fan@example.com');

    const inbound = world.audit.entries().find((entry) => entry.kind === 'inbound');
    expect(JSON.stringify(inbound?.detail)).not.toContain('fan@example.com');
    expect(JSON.stringify(inbound?.detail)).toContain('[email]');
  });

  it('records a failed tool effect with its outcome', async () => {
    const world = createWorld({ script: [toolCall('t1', 'getTier', {}), finalAnswer('I could not read your tier.')], tiers: {} });
    await world.send(GOLD_CHAT, 'what is my tier');

    const failed = world.audit.entries().find((entry) => entry.kind === 'tool');
    expect(failed?.detail).toMatchObject({ tool: 'getTier', outcome: 'error' });
  });
});
