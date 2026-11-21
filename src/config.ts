import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(16),
  QUORUM: z.coerce.number().int().positive().default(2),
  BIG_BATCH: z.coerce.number().int().positive().default(100),
  SLA_HOURS: z.coerce.number().positive().default(48),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_JOB_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RUN_WORKERS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ED25519_PRIVATE_KEY_PEM: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
