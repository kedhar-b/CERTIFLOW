import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./lib/db";
import { logger } from "./lib/logger";
import { redis } from "./lib/redis";
import { startOutboxPublisher } from "./queue/outboxPublisher";
import { closeQueues } from "./queue/queues";
import { startWorkers } from "./queue/workers";

const app = createApp();
const server = app.listen(config.PORT, () => logger.info("CertiFlow API listening", { port: config.PORT }));

let stopPublisher: (() => void) | undefined;
let stopWorkers: (() => Promise<void>) | undefined;

if (config.RUN_WORKERS) {
  stopPublisher = startOutboxPublisher();
  stopWorkers = startWorkers();
}

async function shutdown(signal: string): Promise<void> {
  logger.info("shutting down", { signal });
  stopPublisher?.();
  server.close();
  await stopWorkers?.();
  await closeQueues();
  redis.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
