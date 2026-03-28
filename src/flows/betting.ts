import { randomUUID } from 'node:crypto';
import type { PlacementHandoff, PlacementRequest } from '../clients.js';
import { betOutcome, proposeBetParams } from '../schemas.js';
import { formatMoney, parseWith, type Flow } from './types.js';

export const mintConfirmationRef = (): string => `cnf_${randomUUID()}`;

export const bettingFlow: Flow = {
  toolName: 'proposeBet',
  confirmLabel: 'Confirm bet',
  declineLabel: 'Cancel',
  declinedText: 'Cancelled. No bet was placed.',
  mintsConfirmationRef: true,
  renderCard(args) {
    const slip = parseWith(proposeBetParams, args);
    const legs = slip.selections.map(
      (leg, index) => `${index + 1}. ${leg.eventId} / ${leg.marketId} / ${leg.selectionId} at ${leg.price}`,
    );
    return [
      `Bet proposal (${slip.mode}).`,
      ...legs,
      `Stake ${formatMoney(slip.stake)}.`,
      'Tapping confirm sends this to be placed at the price on the day. If the price has moved I will tell you and nothing is placed.',
    ].join('\n');
  },
  report(outcome) {
    const result = parseWith(betOutcome, outcome);
    if (result.status === 'rejected') {
      return `The bet was not placed. ${result.reasons.join(' ')}`;
    }
    return `Confirmed. Reference ${result.confirmationRef}. Your bet is queued for placement and I will not tell you it is placed until it is.`;
  },
};

/** Stands in for the placement queue that pulse-agents owns. */
export class InMemoryPlacementHandoff implements PlacementHandoff {
  readonly requests: PlacementRequest[] = [];

  async enqueue(request: PlacementRequest): Promise<{ queueId: string }> {
    this.requests.push(request);
    return { queueId: `queue_${this.requests.length}` };
  }
}
