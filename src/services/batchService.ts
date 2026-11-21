import { config } from "../config";
import { nextStatusAfterStep, quorumReached, requiredApprovals } from "../domain/stateMachine";
import { prisma } from "../lib/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import type { SessionUser } from "../types";
import { assertCanReview, assertCanView, assertCentreOwner } from "./policy";
import { enqueueOutbox, lockBatch, writeAudit } from "./txHelpers";

export interface CandidateInput {
  name: string;
  phone: string;
  email?: string | undefined;
}

function slaDeadline(from: Date): Date {
  return new Date(from.getTime() + config.SLA_HOURS * 60 * 60 * 1000);
}

export async function createBatch(user: SessionUser, input: { course: string }) {
  // Centre comes from the session, never from the request.
  if (user.role !== "CENTRE_OPERATOR" || !user.centreId) {
    throw forbidden("Only centre operators can create batches");
  }
  const centreId = user.centreId;

  return prisma.$transaction(async (tx) => {
    const centre = await tx.centre.findUnique({ where: { id: centreId } });
    if (!centre) throw notFound("Centre not found");

    const batch = await tx.batch.create({
      data: {
        centreId: centre.id,
        districtId: centre.districtId,
        course: input.course,
        createdById: user.id,
      },
    });
    await writeAudit(tx, {
      batchId: batch.id,
      actorId: user.id,
      action: "BATCH_CREATED",
      toStatus: "DRAFT",
      version: batch.version,
      details: { course: input.course },
    });
    return batch;
  });
}

export async function addCandidates(user: SessionUser, batchId: string, candidates: CandidateInput[]) {
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    assertCentreOwner(user, batch);
    if (batch.status !== "DRAFT" && batch.status !== "CHANGES_REQUESTED") {
      throw conflict(`Candidates cannot be changed while the batch is ${batch.status}`);
    }

    await tx.candidate.createMany({
      data: candidates.map((candidate) => ({
        batchId,
        name: candidate.name,
        phone: candidate.phone,
        email: candidate.email ?? null,
      })),
    });
    await writeAudit(tx, {
      batchId,
      actorId: user.id,
      action: "CANDIDATES_ADDED",
      version: batch.version,
      details: { count: candidates.length },
    });
    return { added: candidates.length };
  });
}

/** DRAFT -> DISTRICT_REVIEW (version unchanged) or CHANGES_REQUESTED -> DISTRICT_REVIEW (version + 1). */
async function moveToDistrictReview(user: SessionUser, batchId: string, action: "SUBMITTED" | "RESUBMITTED") {
  const expectedFrom = action === "SUBMITTED" ? "DRAFT" : "CHANGES_REQUESTED";

  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    assertCentreOwner(user, batch);
    if (batch.status !== expectedFrom) {
      throw conflict(`Batch must be ${expectedFrom} to be ${action.toLowerCase()}`);
    }

    const size = await tx.candidate.count({ where: { batchId } });
    if (size === 0) throw badRequest("Add at least one candidate first");

    const now = new Date();
    const version = action === "RESUBMITTED" ? batch.version + 1 : batch.version;
    const updated = await tx.batch.update({
      where: { id: batchId },
      data: { status: "DISTRICT_REVIEW", version, size, submittedAt: now, slaDueAt: slaDeadline(now) },
    });
    await writeAudit(tx, {
      batchId,
      actorId: user.id,
      action: `BATCH_${action}`,
      fromStatus: batch.status,
      toStatus: "DISTRICT_REVIEW",
      version,
      details: { size },
    });
    return updated;
  });
}

export const submitBatch = (user: SessionUser, batchId: string) => moveToDistrictReview(user, batchId, "SUBMITTED");
export const resubmitBatch = (user: SessionUser, batchId: string) => moveToDistrictReview(user, batchId, "RESUBMITTED");

export async function approveBatch(user: SessionUser, batchId: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    const step = assertCanReview(user, batch);

    // Checked while holding the lock, so no unique violation has to be caught and swallowed.
    const alreadyApproved = await tx.approval.findFirst({
      where: { batchId, version: batch.version, step, officerId: user.id },
    });
    if (alreadyApproved) throw conflict("You have already approved this batch at this step");

    await tx.approval.create({ data: { batchId, version: batch.version, step, officerId: user.id } });

    // Only approvals for the current version count; older versions stay in the table as history.
    const approvals = await tx.approval.findMany({
      where: { batchId, version: batch.version, step },
      select: { officerId: true },
    });
    const officerIds = approvals.map((approval) => approval.officerId);
    const reached = quorumReached(officerIds, requiredApprovals(step, config.QUORUM));

    if (!reached) {
      await writeAudit(tx, {
        batchId,
        actorId: user.id,
        action: "APPROVAL_RECORDED",
        fromStatus: batch.status,
        toStatus: batch.status,
        version: batch.version,
        details: { step, approvals: new Set(officerIds).size, needed: config.QUORUM },
      });
      return tx.batch.findUniqueOrThrow({ where: { id: batchId } });
    }

    const nextStatus = nextStatusAfterStep(step, batch.size, config.BIG_BATCH);
    const updated = await tx.batch.update({
      where: { id: batchId },
      data: { status: nextStatus, slaDueAt: nextStatus === "APPROVED" ? null : slaDeadline(new Date()) },
    });
    await writeAudit(tx, {
      batchId,
      actorId: user.id,
      action: "STEP_APPROVED",
      fromStatus: batch.status,
      toStatus: nextStatus,
      version: batch.version,
      details: { step },
    });

    if (nextStatus === "APPROVED") {
      await enqueueOutbox(tx, {
        type: "BATCH_APPROVED",
        payload: { batchId, version: batch.version },
        idempotencyKey: `batch:${batchId}:v${batch.version}:approved`,
      });
    }
    return updated;
  });
}

async function leaveReview(user: SessionUser, batchId: string, outcome: "CHANGES_REQUESTED" | "REJECTED", reason: string) {
  return prisma.$transaction(async (tx) => {
    const batch = await lockBatch(tx, batchId);
    const step = assertCanReview(user, batch);

    // Approvals and earlier audit rows are kept either way; they are history.
    const updated = await tx.batch.update({ where: { id: batchId }, data: { status: outcome, slaDueAt: null } });
    await writeAudit(tx, {
      batchId,
      actorId: user.id,
      action: outcome === "CHANGES_REQUESTED" ? "BATCH_SENT_BACK" : "BATCH_REJECTED",
      fromStatus: batch.status,
      toStatus: outcome,
      version: batch.version,
      details: { step, reason },
    });
    return updated;
  });
}

export const sendBackBatch = (user: SessionUser, batchId: string, reason: string) =>
  leaveReview(user, batchId, "CHANGES_REQUESTED", reason);
export const rejectBatch = (user: SessionUser, batchId: string, reason: string) =>
  leaveReview(user, batchId, "REJECTED", reason);

export async function getBatchForUser(user: SessionUser, batchId: string) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Batch not found");
  assertCanView(user, batch);

  const currentApprovals = await prisma.approval.findMany({
    where: { batchId, version: batch.version },
    select: { step: true, officerId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    id: batch.id,
    course: batch.course,
    status: batch.status,
    version: batch.version,
    size: batch.size,
    centreId: batch.centreId,
    districtId: batch.districtId,
    slaDueAt: batch.slaDueAt,
    currentVersionApprovals: currentApprovals,
  };
}
