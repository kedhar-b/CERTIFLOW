import type { BatchStatus, ReviewStep, Role } from "../generated/prisma/enums";

/** Statuses in which a reviewer can approve, send back or reject. */
const REVIEW_STATUS_TO_STEP: Partial<Record<BatchStatus, ReviewStep>> = {
  DISTRICT_REVIEW: "DISTRICT",
  QUALITY_REVIEW: "QUALITY",
  STATE_REVIEW: "STATE",
};

const STEP_TO_ROLE: Record<ReviewStep, Role> = {
  DISTRICT: "DISTRICT_OFFICER",
  QUALITY: "QUALITY_OFFICER",
  STATE: "STATE_OFFICER",
};

export function stepForStatus(status: BatchStatus): ReviewStep | null {
  return REVIEW_STATUS_TO_STEP[status] ?? null;
}

export function roleForStep(step: ReviewStep): Role {
  return STEP_TO_ROLE[step];
}

export function nextStatusAfterStep(step: ReviewStep, batchSize: number, bigBatchThreshold: number): BatchStatus {
  if (step === "DISTRICT") {
    return batchSize >= bigBatchThreshold ? "QUALITY_REVIEW" : "STATE_REVIEW";
  }
  if (step === "QUALITY") {
    return "STATE_REVIEW";
  }
  return "APPROVED";
}

/** Quorum counts distinct officers, so the same officer cannot satisfy it twice. */
export function quorumReached(officerIds: string[], quorum: number): boolean {
  return new Set(officerIds).size >= quorum;
}

/** DISTRICT needs a quorum of distinct officers; QUALITY and STATE need a single approval. */
export function requiredApprovals(step: ReviewStep, quorum: number): number {
  return step === "DISTRICT" ? quorum : 1;
}
