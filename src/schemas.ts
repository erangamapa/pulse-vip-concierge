import { z } from 'zod';
import { createDeal, createLimitRequest, slipDraft } from 'sportsbook-contracts';

// filedBy and accountId are stamped server side. The model never supplies who it is acting for.
export const fileLimitRequestParams = createLimitRequest.omit({ filedBy: true });
export const proposeDealParams = createDeal.omit({ filedBy: true });
export const proposeBetParams = slipDraft.omit({ accountId: true });

export const getTierParams = z.object({});
export const listLimitRequestsParams = z.object({});
export const getBenefitsParams = z.object({
  topic: z.string().min(1).max(200).optional(),
});
export const getOddsParams = z.object({
  eventId: z.string().min(1),
  marketId: z.string().min(1).optional(),
});

export const limitOutcome = z.object({
  requestId: z.string().min(1),
  status: z.string().min(1),
});
export const dealOutcome = z.object({
  dealId: z.string().min(1),
  status: z.string().min(1),
});
export const betOutcome = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('handed_off'),
    confirmationRef: z.string().min(1),
    queueId: z.string().min(1),
  }),
  z.object({
    status: z.literal('rejected'),
    reasons: z.array(z.string()),
  }),
]);
