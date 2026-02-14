import { z } from 'zod';

const bindingSeed = z.array(z.object({ chatId: z.number().int(), customerId: z.string().min(1) }));

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  MANAGER_WEBHOOK_SECRET: z.string().min(1),
  LOYALTY_API_URL: z.string().url(),
  LOYALTY_API_TOKEN: z.string().min(1),
  TRADING_API_URL: z.string().url(),
  TRADING_API_TOKEN: z.string().min(1),
  PLACEMENT_QUEUE_URL: z.string().url(),
  PLACEMENT_QUEUE_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  VIP_BINDINGS: z.string().default('[]'),
});

export type Config = Omit<z.infer<typeof envSchema>, 'VIP_BINDINGS'> & {
  bindings: z.infer<typeof bindingSeed>;
};

export const loadConfig = (env: NodeJS.ProcessEnv): Config => {
  const { VIP_BINDINGS, ...rest } = envSchema.parse(env);
  return { ...rest, bindings: bindingSeed.parse(JSON.parse(VIP_BINDINGS)) };
};
