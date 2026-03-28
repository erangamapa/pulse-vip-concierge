import { fileLimitRequestParams, limitOutcome } from '../schemas.js';
import { formatMoney, parseWith, type Flow } from './types.js';

const KIND_WORDING = {
  maxStakePerBet: 'max stake per bet',
  maxStakePerMarket: 'max stake per market',
  dailyCap: 'daily cap',
} as const;

export const limitsFlow: Flow = {
  toolName: 'fileLimitRequest',
  confirmLabel: 'File request',
  declineLabel: 'Cancel',
  declinedText: 'Cancelled. Nothing was filed.',
  mintsConfirmationRef: false,
  renderCard(args) {
    const request = parseWith(fileLimitRequestParams, args);
    const lines = [
      'Please check this before I file it.',
      `Request a ${KIND_WORDING[request.kind]} of ${formatMoney(request.requestedValue)}.`,
      ...(request.eventContext ? [`For ${request.eventContext}.`] : []),
      `Reason given. ${request.reason}`,
      'This is a request only. Your account manager decides, and nothing changes until they approve it.',
    ];
    return lines.join('\n');
  },
  report(outcome) {
    const { requestId, status } = parseWith(limitOutcome, outcome);
    return `Request ${requestId} is filed and its status is ${status}. Your account manager will decide. I will message you here when they do.`;
  },
};

export const describeLimitDecision = (requestId: string, status: 'approved' | 'declined'): string =>
  status === 'approved'
    ? `Good news. Your account manager approved limit request ${requestId}. The new limit is now in place.`
    : `Your account manager declined limit request ${requestId}. Your limits are unchanged. Reply here if you want to talk it through.`;
