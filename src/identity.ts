import { randomBytes } from 'node:crypto';

export interface Binding {
  chatId: number;
  customerId: string;
  verifiedAt: string;
}

/**
 * A binding exists only after an account manager issued a one time link code and
 * the customer redeemed it from their own chat. Nothing else creates one.
 */
export interface BindingStore {
  customerFor(chatId: number): Promise<string | undefined>;
  chatFor(customerId: string): Promise<number | undefined>;
  issueLinkCode(customerId: string): Promise<string>;
  redeem(chatId: number, code: string): Promise<string | undefined>;
}

export interface InMemoryBindingOptions {
  seed?: readonly Binding[];
  now?: () => Date;
  codeTtlMs?: number;
  newCode?: () => string;
}

interface IssuedCode {
  customerId: string;
  expiresAt: number;
}

const DEFAULT_CODE_TTL_MS = 15 * 60 * 1000;

export class InMemoryBindingStore implements BindingStore {
  private readonly byChat = new Map<number, Binding>();
  private readonly byCustomer = new Map<string, Binding>();
  private readonly codes = new Map<string, IssuedCode>();
  private readonly now: () => Date;
  private readonly codeTtlMs: number;
  private readonly newCode: () => string;

  constructor(options: InMemoryBindingOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.codeTtlMs = options.codeTtlMs ?? DEFAULT_CODE_TTL_MS;
    this.newCode = options.newCode ?? (() => randomBytes(6).toString('hex'));
    for (const binding of options.seed ?? []) this.store(binding);
  }

  async customerFor(chatId: number): Promise<string | undefined> {
    return this.byChat.get(chatId)?.customerId;
  }

  async chatFor(customerId: string): Promise<number | undefined> {
    return this.byCustomer.get(customerId)?.chatId;
  }

  async issueLinkCode(customerId: string): Promise<string> {
    const code = this.newCode();
    this.codes.set(code, { customerId, expiresAt: this.now().getTime() + this.codeTtlMs });
    return code;
  }

  async redeem(chatId: number, code: string): Promise<string | undefined> {
    const issued = this.codes.get(code);
    this.codes.delete(code);
    if (!issued || issued.expiresAt < this.now().getTime()) return undefined;
    this.store({ chatId, customerId: issued.customerId, verifiedAt: this.now().toISOString() });
    return issued.customerId;
  }

  private store(binding: Binding): void {
    this.byChat.set(binding.chatId, binding);
    this.byCustomer.set(binding.customerId, binding);
  }
}

export type AuthOutcome =
  | { kind: 'bound'; customerId: string }
  | { kind: 'linked'; customerId: string }
  | { kind: 'refused'; reason: 'not_private' | 'unknown_chat' | 'bad_code' };

export interface AuthInput {
  chatId: number;
  chatType: string;
  text?: string | undefined;
}

const START_PREFIX = '/start ';

export const authenticate = async (store: BindingStore, input: AuthInput): Promise<AuthOutcome> => {
  if (input.chatType !== 'private') return { kind: 'refused', reason: 'not_private' };

  const existing = await store.customerFor(input.chatId);
  if (existing) return { kind: 'bound', customerId: existing };

  if (input.text?.startsWith(START_PREFIX)) {
    const customerId = await store.redeem(input.chatId, input.text.slice(START_PREFIX.length).trim());
    return customerId ? { kind: 'linked', customerId } : { kind: 'refused', reason: 'bad_code' };
  }
  return { kind: 'refused', reason: 'unknown_chat' };
};

export const REFUSAL_TEXT =
  'This is a private service for verified accounts. If you should have access, ask your account manager for a link code.';

export const threadIdFor = (chatId: number): string => `tg-${chatId}`;
