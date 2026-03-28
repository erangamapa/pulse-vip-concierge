import { dealOutcome, proposeDealParams } from '../schemas.js';
import { parseWith, type Flow } from './types.js';

export const dealsFlow: Flow = {
  toolName: 'proposeDeal',
  confirmLabel: 'Send proposal',
  declineLabel: 'Cancel',
  declinedText: 'Cancelled. Nothing was sent.',
  mintsConfirmationRef: false,
  renderCard(args) {
    const deal = parseWith(proposeDealParams, args);
    const lines = [
      'Please check this before I send it.',
      deal.summary,
      `Terms. ${deal.terms}`,
      ...(deal.eventContext ? [`For ${deal.eventContext}.`] : []),
      'This is a proposal only. Your account manager decides, and no terms apply until they approve it.',
    ];
    return lines.join('\n');
  },
  report(outcome) {
    const { dealId, status } = parseWith(dealOutcome, outcome);
    return `Deal ${dealId} is with your account manager and its status is ${status}. I will message you here when they decide.`;
  },
};

export const describeDealDecision = (dealId: string, status: 'approved' | 'declined'): string =>
  status === 'approved'
    ? `Good news. Your account manager approved deal ${dealId}. They will confirm the terms with you directly.`
    : `Your account manager declined deal ${dealId}. Reply here if you want to adjust it.`;
