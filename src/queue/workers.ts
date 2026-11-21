import { Worker, type Job } from "bullmq";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";
import { createRedisConnection } from "../lib/redis";
import { issueBatch } from "../services/issuingService";
import { QUEUE_NAMES, deadLetterQueue } from "./queues";
import { whatsappProvider } from "./whatsappProvider";

interface IssuanceJob {
  outboxId: string;
  batchId: string;
}

interface WhatsAppJob {
  outboxId: string;
  certificateId: string;
}

async function markOutboxDone(outboxId: string): Promise<void> {
  await prisma.outboxEvent.update({ where: { id: outboxId }, data: { status: "DONE", processedAt: new Date() } });
}

export async function handleIssuanceJob(job: Pick<Job<IssuanceJob>, "data">): Promise<void> {
  // issueBatch is idempotent, so a retried job after a partial failure is harmless.
  await issueBatch(job.data.batchId);
  await markOutboxDone(job.data.outboxId);
}

export async function handleWhatsAppJob(job: Pick<Job<WhatsAppJob>, "data">): Promise<void> {
  const event = await prisma.outboxEvent.findUnique({ where: { id: job.data.outboxId } });
  if (event?.status === "DONE") return;

  const certificate = await prisma.certificate.findUnique({
    where: { id: job.data.certificateId },
    select: { number: true, course: true, status: true, candidate: { select: { name: true, phone: true } } },
  });
  if (!certificate || certificate.status === "CANCELLED") {
    await markOutboxDone(job.data.outboxId);
    return;
  }

  // The same key goes to the provider on every retry, so the candidate is never messaged twice.
  await whatsappProvider.send({
    to: certificate.candidate.phone,
    template: "certificate_issued",
    params: { name: certificate.candidate.name, number: certificate.number, course: certificate.course },
    idempotencyKey: `cert:${job.data.certificateId}:issued`,
  });
  await markOutboxDone(job.data.outboxId);
}

function attachFailureHandling(worker: Worker): void {
  worker.on("failed", (job, error) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    const outboxId = (job.data as { outboxId?: string }).outboxId;

    if (outboxId) {
      void prisma.outboxEvent
        .update({
          where: { id: outboxId },
          data: { attempts: job.attemptsMade, lastError: error.message.slice(0, 500) },
        })
        .catch((updateError: unknown) => logger.error("could not record job failure", { error: String(updateError) }));
    }

    // Out of retries: park the job in the dead-letter queue and mark the outbox row FAILED.
    if (job.attemptsMade >= maxAttempts) {
      void deadLetterQueue
        .add(job.name, { queue: worker.name, data: job.data, error: error.message }, { jobId: `dead-${job.id}` })
        .catch((deadLetterError: unknown) => logger.error("dead-letter add failed", { error: String(deadLetterError) }));
      if (outboxId) {
        void prisma.outboxEvent
          .update({ where: { id: outboxId }, data: { status: "FAILED" } })
          .catch((updateError: unknown) => logger.error("could not mark outbox failed", { error: String(updateError) }));
      }
      logger.error("job moved to dead-letter queue", { queue: worker.name, jobId: job.id });
    }
  });
}

export function startWorkers(): () => Promise<void> {
  const issuanceWorker = new Worker<IssuanceJob>(QUEUE_NAMES.issuance, handleIssuanceJob, {
    connection: createRedisConnection(),
    concurrency: 2,
  });
  const whatsappWorker = new Worker<WhatsAppJob>(QUEUE_NAMES.whatsapp, handleWhatsAppJob, {
    connection: createRedisConnection(),
    concurrency: 10,
  });
  attachFailureHandling(issuanceWorker);
  attachFailureHandling(whatsappWorker);

  return async () => {
    await Promise.all([issuanceWorker.close(), whatsappWorker.close()]);
  };
}
