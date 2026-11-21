import type { Prisma } from "../generated/prisma/client";
import type { BatchStatus } from "../generated/prisma/enums";
import type { Tx } from "../lib/db";
import { notFound } from "../lib/errors";

/**
 * Takes a row lock on the batch for the rest of the transaction. Two officers approving at the same
 * moment would otherwise both read "one approval so far" and neither would see the quorum being met,
 * and resubmit/approve could race on `version`.
 */
export async function lockBatch(tx: Tx, batchId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM batches WHERE id = ${batchId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Batch not found");
  return tx.batch.findUniqueOrThrow({ where: { id: batchId } });
}

export interface AuditEntry {
  batchId?: string | null;
  actorId?: string | null;
  action: string;
  fromStatus?: BatchStatus | null;
  toStatus?: BatchStatus | null;
  version?: number | null;
  details?: Prisma.InputJsonValue;
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      batchId: entry.batchId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      fromStatus: entry.fromStatus ?? null,
      toStatus: entry.toStatus ?? null,
      version: entry.version ?? null,
      details: entry.details,
    },
  });
}

export interface OutboxEntry {
  type: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
}

/** Callers hold the batch lock, so checking first is race-free and no unique-violation is ever caught. */
export async function enqueueOutbox(tx: Tx, entry: OutboxEntry): Promise<void> {
  const existing = await tx.outboxEvent.findUnique({ where: { idempotencyKey: entry.idempotencyKey } });
  if (existing) return;
  await tx.outboxEvent.create({
    data: { type: entry.type, payload: entry.payload, idempotencyKey: entry.idempotencyKey },
  });
}
