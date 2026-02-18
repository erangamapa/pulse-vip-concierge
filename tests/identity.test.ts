import { describe, expect, it } from 'vitest';
import { InMemoryBindingStore, authenticate } from '../src/identity.js';
import { finalAnswer } from './support/scripted-model.js';
import { GOLD_CHAT, GOLD_CUSTOMER, STRANGER_CHAT, createWorld, photoUpdate } from './support/world.js';

describe('identity', () => {
  it('resolves a bound private chat to its customer', async () => {
    const store = new InMemoryBindingStore({
      seed: [{ chatId: 5, customerId: 'cust_5', verifiedAt: '2026-05-01T00:00:00.000Z' }],
    });
    expect(await authenticate(store, { chatId: 5, chatType: 'private' })).toEqual({ kind: 'bound', customerId: 'cust_5' });
  });

  it('refuses an unknown chat politely and never reaches the model', async () => {
    const world = createWorld({ script: [finalAnswer('should never be said')] });
    await world.send(STRANGER_CHAT, 'raise my limit to a million');

    expect(world.model.calls).toBe(0);
    expect(world.lastText().chatId).toBe(STRANGER_CHAT);
    expect(world.lastText().text).toContain('private service for verified accounts');
    expect(world.audit.entries().map((entry) => entry.kind)).toEqual(['refused']);
  });

  it('refuses group chats even when the member is bound elsewhere', async () => {
    const store = new InMemoryBindingStore({
      seed: [{ chatId: 5, customerId: 'cust_5', verifiedAt: '2026-05-01T00:00:00.000Z' }],
    });
    expect(await authenticate(store, { chatId: 5, chatType: 'group' })).toEqual({
      kind: 'refused',
      reason: 'not_private',
    });
  });

  it('binds a chat with a one time link code and rejects reuse', async () => {
    const world = createWorld({ script: [] });
    const code = await world.bindings.issueLinkCode('cust_2002');

    await world.send(STRANGER_CHAT, `/start ${code}`);
    expect(world.lastText().text).toContain('You are linked');
    expect(await world.bindings.customerFor(STRANGER_CHAT)).toBe('cust_2002');

    await world.send(4444, `/start ${code}`);
    expect(world.lastText().text).toContain('private service for verified accounts');
    expect(await world.bindings.customerFor(4444)).toBeUndefined();
  });

  it('expires link codes', async () => {
    let clock = new Date('2026-06-01T10:00:00.000Z');
    const store = new InMemoryBindingStore({ now: () => clock, codeTtlMs: 1000 });
    const code = await store.issueLinkCode('cust_1');
    clock = new Date('2026-06-01T10:00:05.000Z');
    expect(await store.redeem(7, code)).toBeUndefined();
  });

  it('answers a bound chat and tells it when a message has no text', async () => {
    const world = createWorld({ script: [finalAnswer('Hello.')] });
    await world.send(GOLD_CHAT, 'hi');
    expect(world.lastText().text).toBe('Hello.');
    expect(world.audit.entries().at(0)?.customerId).toBe(GOLD_CUSTOMER);

    await world.handle(photoUpdate(GOLD_CHAT));
    expect(world.lastText().text).toBe('I can only read text messages.');
  });
});
