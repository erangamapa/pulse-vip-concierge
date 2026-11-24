import { describe, expect, it } from 'vitest';
import { finalAnswer, toolCall } from './support/scripted-model.js';
import { GOLD_CHAT, GOLD_CUSTOMER, createWorld } from './support/world.js';

const proposal = {
  selections: [{ eventId: 'ev_final', marketId: 'm_winner', selectionId: 's_home', price: '2.1' }],
  stake: { currency: 'USD', amount: '5000' },
  mode: 'single',
};

const script = () => [toolCall('b1', 'proposeBet', proposal), finalAnswer('model text that is not shown')];

describe('bet proposal flow', () => {
  it('shows a card, and a confirm hands off with a confirmation reference', async () => {
    const world = createWorld({ script: script() });
    await world.send(GOLD_CHAT, 'put 5000 on the home side in the final');

    const card = world.lastText();
    expect(card.text).toContain('Stake USD 5000.');
    expect(card.buttons).toEqual(['Confirm bet', 'Cancel']);
    expect(world.placement.requests).toHaveLength(0);

    await world.press(GOLD_CHAT, 'c:tok:y');
    expect(world.placement.requests).toHaveLength(1);
    expect(world.placement.requests[0]).toMatchObject({
      slipId: 'slip_1',
      confirmationRef: 'cnf_test',
      customerId: GOLD_CUSTOMER,
      onBehalfOf: GOLD_CUSTOMER,
      placedBy: { kind: 'agent', id: 'concierge' },
      stake: { currency: 'USD', amount: '5000' },
    });
    expect(world.placement.requests[0]?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(world.lastText().text).toContain('Reference cnf_test');
    expect(world.lastText().text).toContain('queued for placement');
  });

  it('hands off nothing when the customer declines', async () => {
    const world = createWorld({ script: script() });
    await world.send(GOLD_CHAT, 'put 5000 on the home side');
    await world.press(GOLD_CHAT, 'c:tok:n');

    expect(world.placement.requests).toHaveLength(0);
    expect(world.lastText().text).toBe('Cancelled. No bet was placed.');
  });

  it('hands off nothing when the price moved before the tap', async () => {
    const world = createWorld({ script: script() });
    await world.send(GOLD_CHAT, 'put 5000 on the home side');
    world.trading.repriced = true;
    await world.press(GOLD_CHAT, 'c:tok:y');

    expect(world.placement.requests).toHaveLength(0);
    expect(world.lastText().text).toContain('The bet was not placed.');
  });

  it('cannot be confirmed twice', async () => {
    const world = createWorld({ script: script() });
    await world.send(GOLD_CHAT, 'put 5000 on the home side');
    await world.press(GOLD_CHAT, 'c:tok:y');
    await world.press(GOLD_CHAT, 'c:tok:y');

    expect(world.placement.requests).toHaveLength(1);
    expect(world.lastText().text).toContain('no longer active');
  });

  it('does not accept a stake that is not a decimal string', async () => {
    const bad = { ...proposal, stake: { currency: 'USD', amount: '-5' } };
    const world = createWorld({ script: [toolCall('b1', 'proposeBet', bad), finalAnswer('I could not set that up.')] });
    await world.send(GOLD_CHAT, 'bet minus five');

    expect(world.lastText().text).toBe('I could not set that up.');
    expect(world.placement.requests).toHaveLength(0);
  });
});
