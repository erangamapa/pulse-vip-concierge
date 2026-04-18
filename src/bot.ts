import { Bot, Context, InlineKeyboard, type BotConfig } from 'grammy';
import { maskPII } from 'agentloop';
import type { AuditLog } from './audit.js';
import type { Conversation, Reply } from './conversation.js';
import { REFUSAL_TEXT, authenticate, threadIdFor, type BindingStore } from './identity.js';

export interface ConciergeContext extends Context {
  concierge: { chatId: number; customerId: string };
}

export interface BotDeps {
  token: string;
  bindings: BindingStore;
  audit: AuditLog;
  conversation: Conversation;
  botConfig?: BotConfig<ConciergeContext>;
  onError?: (error: unknown) => void;
}

const LINKED_TEXT = 'You are linked. Tell me what you need.';
const TEXT_ONLY = 'I can only read text messages.';
const BROKEN = 'I hit a problem on my side. Please try again in a moment.';

const toExtra = (reply: Reply) =>
  reply.buttons && reply.buttons.length > 0
    ? {
        reply_markup: reply.buttons.reduce(
          (keyboard, button) => keyboard.text(button.label, button.data),
          new InlineKeyboard(),
        ),
      }
    : {};

const inboundSummary = (ctx: Context): Record<string, unknown> => {
  const callback = ctx.callbackQuery?.data;
  if (callback) return { type: 'callback_query', data: callback };
  return { type: 'message', text: maskPII(ctx.message?.text ?? ''), hasText: ctx.message?.text !== undefined };
};

/**
 * The chain is identity, then audit, then conversation. Nothing downstream of
 * identity runs for a chat that is not bound, so an unknown chat never reaches
 * the model or any tool.
 */
export const createBot = (deps: BotDeps): Bot<ConciergeContext> => {
  const { bindings, audit, conversation } = deps;
  const bot = new Bot<ConciergeContext>(deps.token, deps.botConfig);

  bot.use(async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat) return;
    const outcome = await authenticate(bindings, {
      chatId: chat.id,
      chatType: chat.type,
      text: ctx.message?.text,
    });

    if (outcome.kind === 'refused') {
      await audit.append({ kind: 'refused', threadId: threadIdFor(chat.id), detail: { reason: outcome.reason } });
      await ctx.reply(REFUSAL_TEXT);
      return;
    }
    if (outcome.kind === 'linked') {
      await audit.append({
        kind: 'linked',
        threadId: threadIdFor(chat.id),
        customerId: outcome.customerId,
        detail: {},
      });
      await ctx.reply(LINKED_TEXT);
      return;
    }
    ctx.concierge = { chatId: chat.id, customerId: outcome.customerId };
    await next();
  });

  bot.use(async (ctx, next) => {
    const { chatId, customerId } = ctx.concierge;
    await audit.append({
      kind: 'inbound',
      threadId: threadIdFor(chatId),
      customerId,
      detail: { updateId: ctx.update.update_id, ...inboundSummary(ctx) },
    });
    await next();
  });

  bot.on('message:text', async (ctx) => {
    const reply = await conversation.onText(ctx.concierge, ctx.message.text);
    await ctx.reply(reply.text, toExtra(reply));
  });

  bot.on('callback_query:data', async (ctx) => {
    await ctx.answerCallbackQuery();
    const reply = await conversation.onButton(ctx.concierge, ctx.callbackQuery.data);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(reply.text, toExtra(reply));
  });

  bot.on('message', (ctx) => ctx.reply(TEXT_ONLY));

  bot.catch(async ({ error, ctx }) => {
    deps.onError?.(error);
    await ctx.reply(BROKEN).catch(() => undefined);
  });

  return bot;
};
