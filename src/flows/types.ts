import type { z } from 'zod';

/**
 * A flow owns the customer facing side of one gated tool. It words the
 * confirmation card from the validated arguments and words the outcome from the
 * tool result. The model never writes either, so a card or a status line cannot
 * claim more than the system did.
 */
export interface Flow {
  toolName: string;
  confirmLabel: string;
  declineLabel: string;
  declinedText: string;
  /** A bet confirmation needs a reference minted at the moment of the tap. */
  mintsConfirmationRef: boolean;
  renderCard(args: unknown): string;
  report(outcome: unknown): string;
}

export const formatMoney = (value: { currency: string; amount: string }): string =>
  `${value.currency} ${value.amount}`;

export const parseWith = <S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> =>
  schema.parse(value);
