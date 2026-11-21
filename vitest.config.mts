import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one database, so files run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      SESSION_SECRET: "test-secret-test-secret",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://certiflow:certiflow_dev@localhost:5433/certiflow",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      QUORUM: "2",
      BIG_BATCH: "5",
      CACHE_TTL_SECONDS: "60",
    },
  },
});
