import { config } from "../config";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { OUTBOX_TYPE_TO_QUEUE, defaultJobOptions } from "./queues";

const BATCH_SIZE = 50;

/**
 * Moves PENDING outbox rows into BullMQ. The outbox id is used as the job id, so if the process dies
 * between queue.add and the status update the next run adds the same job again and BullMQ ignores it.
 */
export async function publishPendingOutboxEvents(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM outbox_events
      WHERE status = 'PENDING'
      ORDER BY created_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED`;
    if (rows.length === 0) return 0;

    const events = await tx.outboxEvent.findMany({ where: { id: { in: rows.map((row) => row.id) } } });
    let published = 0;

    for (const event of events) {
      const queue = OUTBOX_TYPE_TO_QUEUE[event.type];
      if (!queue) {
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: { status: "FAILED", lastError: `Unknown event type ${event.type}` },
        });
        continue;
      }
      const payload = event.payload as Record<string, unknown>;
      await queue.add(event.type, { outboxId: event.id, ...payload }, { ...defaultJobOptions, jobId: event.id });
      await tx.outboxEvent.update({ where: { id: event.id }, data: { status: "PUBLISHED" } });
      published += 1;
    }
    return published;
  });
}

export function startOutboxPublisher(intervalMs = 1000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    publishPendingOutboxEvents()
      .catch((error: unknown) => logger.error("outbox publish failed", { error: String(error) }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);

  logger.info("outbox publisher started", { intervalMs, maxAttempts: config.MAX_JOB_ATTEMPTS });
  return () => clearInterval(timer);
}
