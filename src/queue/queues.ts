import { Queue, type JobsOptions } from "bullmq";
import { config } from "../config";
import { createRedisConnection } from "../lib/redis";

export const QUEUE_NAMES = {
  issuance: "issuance",
  whatsapp: "whatsapp",
  deadLetter: "dead-letter",
} as const;

export const defaultJobOptions: JobsOptions = {
  attempts: config.MAX_JOB_ATTEMPTS,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: false,
};

const connection = createRedisConnection();

export const issuanceQueue = new Queue(QUEUE_NAMES.issuance, { connection, defaultJobOptions });
export const whatsappQueue = new Queue(QUEUE_NAMES.whatsapp, { connection, defaultJobOptions });
export const deadLetterQueue = new Queue(QUEUE_NAMES.deadLetter, { connection });

export const OUTBOX_TYPE_TO_QUEUE: Record<string, Queue> = {
  BATCH_APPROVED: issuanceQueue,
  WHATSAPP_CERTIFICATE_ISSUED: whatsappQueue,
};

export async function closeQueues(): Promise<void> {
  await Promise.all([issuanceQueue.close(), whatsappQueue.close(), deadLetterQueue.close()]);
  connection.disconnect();
}
