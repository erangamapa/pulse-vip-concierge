import { describe, expect, it } from 'vitest';
import { SIGNATURE_HEADER, signBody, verifySignature } from '../src/notify.js';
import { finalAnswer, toolCall } from './support/scripted-model.js';
import { GOLD_CHAT, GOLD_CUSTOMER, createWorld } from './support/world.js';

const finalsRequest = {
  kind: 'maxStakePerBet',
  requestedValue: { currency: 'USD', amount: '25000' },
  reason: 'World cup final week, I want to size up on the final.',
  eventContext: 'World Cup final week',
};

const script = () => [
  finalAnswer('Which value and which event?'),
  toolCall('c1', 'fileLimitRequest', finalsRequest),
  finalAnswer('This sentence from the model is never shown.'),
];

describe('limit request flow', () => {
  it('collects details, confirms wording, files as the agent and reports pending', async () => {
    const world = createWorld({ script: script() });

    await world.send(GOLD_CHAT, 'I need a bigger max stake for the finals');
    expect(world.lastText().text).toBe('Which value and which event?');

    await world.send(GOLD_CHAT, 'USD 25000 per bet for World Cup final week');
    const card = world.lastText();
    expect(card.text).toContain('Request a max stake per bet of USD 25000.');
    expect(card.text).toContain('Your account manager decides');
    expect(card.buttons).toEqual(['File request', 'Cancel']);
    expect(world.loyalty.limitRequests).toHaveLength(0);

    await world.press(GOLD_CHAT, 'c:tok:y');
    expect(world.loyalty.limitRequests).toHaveLength(1);
    expect(world.loyalty.limitRequests[0]).toMatchObject({
      customerId: GOLD_CUSTOMER,
      status: 'pending',
      filedBy: { kind: 'agent', id: 'concierge' },
      requestedValue: { currency: 'USD', amount: '25000' },
    });
    expect(world.loyalty.keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(world.lastText().text).toContain('Request lr_1 is filed and its status is pending');
    expect(world.lastText().text).not.toContain('never shown');
  });

  it('files nothing when the customer cancels', async () => {
    const world = createWorld({ script: [toolCall('c1', 'fileLimitRequest', finalsRequest), finalAnswer('ok')] });
    await world.send(GOLD_CHAT, 'USD 25000 per bet for the final');
    await world.press(GOLD_CHAT, 'c:tok:n');

    expect(world.loyalty.limitRequests).toHaveLength(0);
    expect(world.lastText().text).toBe('Cancelled. Nothing was filed.');
  });

  it('ignores a confirmation tap with the wrong token', async () => {
    const world = createWorld({ script: [toolCall('c1', 'fileLimitRequest', finalsRequest), finalAnswer('ok')] });
    await world.send(GOLD_CHAT, 'USD 25000 per bet for the final');
    await world.press(GOLD_CHAT, 'c:other:y');

    expect(world.loyalty.limitRequests).toHaveLength(0);
    expect(world.lastText().text).toContain('no longer active');
  });

  it('asks for the card to be settled before taking new input', async () => {
    const world = createWorld({ script: [toolCall('c1', 'fileLimitRequest', finalsRequest), finalAnswer('ok')] });
    await world.send(GOLD_CHAT, 'USD 25000 per bet for the final');
    await world.send(GOLD_CHAT, 'actually make it 30000');

    expect(world.lastText().text).toContain('File request or Cancel');
    expect(world.model.calls).toBe(1);
  });

  it('tells the chat when the manager approves or declines', async () => {
    const world = createWorld({ script: script() });
    await world.send(GOLD_CHAT, 'ask');
    await world.send(GOLD_CHAT, 'USD 25000');
    await world.press(GOLD_CHAT, 'c:tok:y');

    const approved = await world.notifier.handle({
      type: 'limit_request',
      id: 'lr_1',
      customerId: GOLD_CUSTOMER,
      status: 'approved',
      decidedBy: 'mgr_7',
    });
    expect(approved).toBe('delivered');
    expect(world.lastText()).toMatchObject({ chatId: GOLD_CHAT });
    expect(world.lastText().text).toContain('approved limit request lr_1');

    await world.notifier.handle({
      type: 'limit_request',
      id: 'lr_1',
      customerId: GOLD_CUSTOMER,
      status: 'declined',
      decidedBy: 'mgr_7',
    });
    expect(world.lastText().text).toContain('declined limit request lr_1');
  });

  it('reports a customer with no linked chat as undeliverable', async () => {
    const world = createWorld({ script: [] });
    const result = await world.notifier.handle({
      type: 'deal',
      id: 'deal_1',
      customerId: 'cust_unlinked',
      status: 'approved',
      decidedBy: 'mgr_7',
    });
    expect(result).toBe('no_chat');
  });
});

describe('manager webhook signature', () => {
  const body = JSON.stringify({ id: 'lr_1' });

  it('accepts the right signature', () => {
    expect(verifySignature('s3cret', body, signBody('s3cret', body))).toBe(true);
  });

  it('rejects a wrong secret, a tampered body and a missing header', () => {
    expect(verifySignature('s3cret', body, signBody('other', body))).toBe(false);
    expect(verifySignature('s3cret', `${body} `, signBody('s3cret', body))).toBe(false);
    expect(verifySignature('s3cret', body, undefined)).toBe(false);
    expect(verifySignature('s3cret', body, 'not-hex')).toBe(false);
  });

  it('uses a lower case header name', () => {
    expect(SIGNATURE_HEADER).toBe('x-signature');
  });
});
