import { z } from 'zod';

const apiConfigSchema = z.object({
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
});

const parsed = apiConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid API configuration:', parsed.error.format());
  process.exit(1);
}

export const apiConfig = parsed.data;
