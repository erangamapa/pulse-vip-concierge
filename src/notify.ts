import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AuditLog } from './audit.js';
import { describeDealDecision } from './flows/deals.js';
import { describeLimitDecision } from './flows/limits.js';
import { threadIdFor, type BindingStore } from './identity.js';

export const decisionPayload = z.object({
  type: z.enum(['limit_request', 'deal']),
  id: z.string().min(1),
  customerId: z.string().min(1),
  status: z.enum(['approved', 'declined']),
  decidedBy: z.string().min(1),
});
export type DecisionPayload = z.infer<typeof decisionPayload>;

export const SIGNATURE_HEADER = 'x-signature';

export const signBody = (secret: string, rawBody: string): string =>
  createHmac('sha256', secret).update(rawBody).digest('hex');

export const verifySignature = (secret: string, rawBody: string, header: string | undefined): boolean => {
  if (!header) return false;
  const expected = Buffer.from(signBody(secret, rawBody), 'hex');
  const given = Buffer.from(header, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export type SendMessage = (chatId: number, text: string) => Promise<void>;

export type DeliveryResult = 'delivered' | 'no_chat';

export interface Notifier {
  handle(payload: DecisionPayload): Promise<DeliveryResult>;
}

export interface NotifierDeps {
  bindings: BindingStore;
  send: SendMessage;
  audit: AuditLog;
}

export const createNotifier = ({ bindings, send, audit }: NotifierDeps): Notifier => ({
  async handle(payload) {
    const chatId = await bindings.chatFor(payload.customerId);
    if (chatId === undefined) return 'no_chat';

    const text =
      payload.type === 'limit_request'
        ? describeLimitDecision(payload.id, payload.status)
        : describeDealDecision(payload.id, payload.status);
    await send(chatId, text);
    await audit.append({
      kind: 'notify',
      threadId: threadIdFor(chatId),
      customerId: payload.customerId,
      detail: { type: payload.type, id: payload.id, status: payload.status, decidedBy: payload.decidedBy },
    });
    return 'delivered';
  },
});
