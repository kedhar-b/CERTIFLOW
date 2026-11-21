import { randomUUID } from "node:crypto";
import { prisma } from "../lib/db";
import { generateCertificateNumber, signCertificate } from "../lib/signing";
import { enqueueOutbox, lockBatch, writeAudit } from "./txHelpers";

const SYSTEM_ACTOR = null;

function todayAsIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** APPROVED -> ISSUING. Safe to call again: any other status is simply left alone. */
async function markIssuing(batchId: string): Promise<"started" | "already-started" | "not-ready"> {
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status === "ISSUING" || batch.status === "ISSUED") return "already-started";
    if (batch.status !== "APPROVED") return "not-ready";

    await tx.batch.update({ where: { id: batchId }, data: { status: "ISSUING" } });
    await writeAudit(tx, {
      batchId,
      actorId: SYSTEM_ACTOR,
      action: "ISSUING_STARTED",
      fromStatus: "APPROVED",
      toStatus: "ISSUING",
      version: batch.version,
    });
    return "started";
  });
}

/** Generates numbers that are not in the database yet, retrying the (very unlikely) collisions. */
async function uniqueNumbers(count: number, tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]): Promise<string[]> {
  const numbers = new Set<string>();
  while (numbers.size < count) {
    const candidates = new Set<string>();
    while (numbers.size + candidates.size < count) {
      const next = generateCertificateNumber();
      if (!numbers.has(next)) candidates.add(next);
    }
    const taken = await tx.certificate.findMany({
      where: { number: { in: [...candidates] } },
      select: { number: true },
    });
    const takenSet = new Set(taken.map((row) => row.number));
    for (const candidate of candidates) {
      if (!takenSet.has(candidate)) numbers.add(candidate);
    }
  }
  return [...numbers];
}

/** ISSUING -> ISSUED. Certificates are created only for candidates that do not have one yet. */
async function completeIssuing(batchId: string): Promise<{ created: number }> {
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    if (batch.status === "ISSUED") return { created: 0 };
    if (batch.status !== "ISSUING") return { created: 0 };

    const candidates = await tx.candidate.findMany({
      where: { batchId, certificate: null },
      select: { id: true },
    });

    const issueDate = todayAsIsoDate();
    const numbers = await uniqueNumbers(candidates.length, tx);

    const rows = candidates.map((candidate, index) => {
      const id = randomUUID();
      const number = numbers[index] as string;
      const signature = signCertificate({ id, number, course: batch.course, issueDate });
      return {
        id,
        candidateId: candidate.id,
        batchId,
        number,
        course: batch.course,
        issueDate: new Date(`${issueDate}T00:00:00.000Z`),
        signature,
      };
    });

    if (rows.length > 0) await tx.certificate.createMany({ data: rows });

    for (const row of rows) {
      await enqueueOutbox(tx, {
        type: "WHATSAPP_CERTIFICATE_ISSUED",
        payload: { certificateId: row.id },
        idempotencyKey: `cert:${row.id}:issued`,
      });
    }

    await tx.batch.update({ where: { id: batchId }, data: { status: "ISSUED" } });
    await writeAudit(tx, {
      batchId,
      actorId: SYSTEM_ACTOR,
      action: "ISSUING_COMPLETED",
      fromStatus: "ISSUING",
      toStatus: "ISSUED",
      version: batch.version,
      details: { certificatesCreated: rows.length },
    });
    return { created: rows.length };
  });
}

/**
 * Idempotent: a retry after a crash picks up wherever the batch was left
 * (APPROVED, ISSUING or already ISSUED) and never creates a second certificate for a candidate.
 */
export async function issueBatch(batchId: string): Promise<{ created: number }> {
  const started = await markIssuing(batchId);
  if (started === "not-ready") return { created: 0 };
  return completeIssuing(batchId);
}
