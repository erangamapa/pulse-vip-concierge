import { randomUUID } from 'node:crypto';
import type { GatePayload, Harness, HarnessResult, RunContext } from 'agentloop';
import { maskPII } from 'agentloop';
import type { AuditLog } from './audit.js';
import { CONCIERGE_AGENT_ID } from './conciergeAgent.js';
import { mintConfirmationRef } from './flows/betting.js';
import type { Flow } from './flows/types.js';
import { threadIdFor } from './identity.js';

export interface Button {
  label: string;
  data: string;
}

export interface Reply {
  text: string;
  buttons?: readonly Button[];
}

export interface Caller {
  chatId: number;
  customerId: string;
}

export interface PendingConfirmation {
  token: string;
  flow: Flow;
}

export interface PendingStore {
  get(chatId: number): PendingConfirmation | undefined;
  set(chatId: number, pending: PendingConfirmation): void;
  clear(chatId: number): void;
}

export class InMemoryPendingStore implements PendingStore {
  private readonly byChat = new Map<number, PendingConfirmation>();

  get(chatId: number): PendingConfirmation | undefined {
    return this.byChat.get(chatId);
  }

  set(chatId: number, pending: PendingConfirmation): void {
    this.byChat.set(chatId, pending);
  }

  clear(chatId: number): void {
    this.byChat.delete(chatId);
  }
}

export interface Conversation {
  onText(caller: Caller, text: string): Promise<Reply>;
  onButton(caller: Caller, data: string): Promise<Reply>;
}

export interface ConversationDeps {
  harness: Harness;
  flows: readonly Flow[];
  audit: AuditLog;
  pending?: PendingStore;
  newToken?: () => string;
  newConfirmationRef?: () => string;
}

const BUTTON_PREFIX = 'c';
const EMPTY_ANSWER = 'I do not have an answer for that. Your account manager can help.';
const FAILED = 'That did not go through and nothing was changed. Please try again, or ask your account manager.';
const STALE = 'That confirmation is no longer active. Tell me what you need and I will set it up again.';

const parseButton = (data: string): { token: string; approved: boolean } | undefined => {
  const [prefix, token, choice] = data.split(':');
  if (prefix !== BUTTON_PREFIX || !token || (choice !== 'y' && choice !== 'n')) return undefined;
  return { token, approved: choice === 'y' };
};

const parseJson = (content: unknown): unknown => {
  if (typeof content !== 'string') return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
};

export const createConversation = (deps: ConversationDeps): Conversation => {
  const { harness, audit } = deps;
  const pending = deps.pending ?? new InMemoryPendingStore();
  const newToken = deps.newToken ?? randomUUID;
  const newConfirmationRef = deps.newConfirmationRef ?? mintConfirmationRef;
  const flowFor = (toolName: string): Flow | undefined => deps.flows.find((flow) => flow.toolName === toolName);

  const runContext = ({ chatId, customerId }: Caller): RunContext => ({
    threadId: threadIdFor(chatId),
    sessionUserId: customerId,
    taskKind: 'converse',
    actor: { kind: 'agent', id: CONCIERGE_AGENT_ID },
  });

  const say = async (caller: Caller, reply: Reply): Promise<Reply> => {
    await audit.append({
      kind: 'outbound',
      threadId: threadIdFor(caller.chatId),
      customerId: caller.customerId,
      detail: { text: maskPII(reply.text), buttons: reply.buttons?.length ?? 0 },
    });
    return reply;
  };

  const cardFor = (caller: Caller, gate: GatePayload, flow: Flow): Reply => {
    const token = newToken();
    pending.set(caller.chatId, { token, flow });
    return {
      text: flow.renderCard(gate.args),
      buttons: [
        { label: flow.confirmLabel, data: `${BUTTON_PREFIX}:${token}:y` },
        { label: flow.declineLabel, data: `${BUTTON_PREFIX}:${token}:n` },
      ],
    };
  };

  const settle = async (caller: Caller, result: HarnessResult): Promise<Reply> => {
    if (result.status === 'interrupted' && result.pending) {
      const flow = flowFor(result.pending.toolName);
      if (flow) return say(caller, cardFor(caller, result.pending, flow));
      // A gate without a flow has no safe wording, so it is declined rather than guessed at.
      return settle(caller, await harness.resume(runContext(caller), { approved: false }));
    }
    return say(caller, { text: result.finalText.trim() || EMPTY_ANSWER });
  };

  const outcomeOf = (result: HarnessResult, toolName: string): { ok: boolean; value: unknown } => {
    const message = result.messages.findLast((candidate) => candidate.getType() === 'tool' && candidate.name === toolName);
    if (!message) return { ok: false, value: undefined };
    const isError = (message as { status?: string }).status === 'error';
    return { ok: !isError, value: parseJson(message.content) };
  };

  return {
    async onText(caller, text) {
      const open = pending.get(caller.chatId);
      if (open) {
        const reminder = `${open.flow.confirmLabel} or ${open.flow.declineLabel} on the card above before we carry on.`;
        return say(caller, { text: reminder });
      }
      return settle(caller, await harness.run({ input: text, context: runContext(caller) }));
    },

    async onButton(caller, data) {
      const choice = parseButton(data);
      const open = pending.get(caller.chatId);
      if (!choice || !open || open.token !== choice.token) return say(caller, { text: STALE });
      pending.clear(caller.chatId);

      const context = runContext(caller);
      if (!choice.approved) {
        await harness.resume(context, { approved: false });
        return say(caller, { text: open.flow.declinedText });
      }

      const result = await harness.resume(context, {
        approved: true,
        ...(open.flow.mintsConfirmationRef ? { confirmationRef: newConfirmationRef() } : {}),
      });
      if (result.status === 'interrupted') return settle(caller, result);

      const outcome = outcomeOf(result, open.flow.toolName);
      if (!outcome.ok) return say(caller, { text: FAILED });
      return say(caller, { text: open.flow.report(outcome.value) });
    },
  };
};
