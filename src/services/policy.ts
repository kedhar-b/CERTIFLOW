import type { Batch } from "../generated/prisma/client";
import type { ReviewStep } from "../generated/prisma/enums";
import { roleForStep, stepForStatus } from "../domain/stateMachine";
import { conflict, forbidden } from "../lib/errors";
import type { SessionUser } from "../types";

/** The centre operator who owns the batch's centre is the only maker. */
export function assertCentreOwner(user: SessionUser, batch: Pick<Batch, "centreId">): void {
  if (user.role !== "CENTRE_OPERATOR" || !user.centreId || user.centreId !== batch.centreId) {
    throw forbidden("Only the owning centre can change this batch");
  }
}

/**
 * Role, step and district checks for approve / send-back / reject.
 * A batch that is not in a review state is a state conflict (409); everything else is 403.
 */
export function assertCanReview(user: SessionUser, batch: Pick<Batch, "status" | "districtId">): ReviewStep {
  const step = stepForStatus(batch.status);
  if (!step) throw conflict(`Batch is in ${batch.status} and cannot be reviewed`);

  if (user.role !== roleForStep(step)) {
    throw forbidden(`${step} review needs a ${roleForStep(step)}`);
  }
  if (step === "DISTRICT" && (!user.districtId || user.districtId !== batch.districtId)) {
    throw forbidden("This batch belongs to another district");
  }
  return step;
}

/** Read access for GET /batches/:id. */
export function assertCanView(user: SessionUser, batch: Pick<Batch, "centreId" | "districtId">): void {
  switch (user.role) {
    case "ADMIN":
    case "STATE_OFFICER":
    case "QUALITY_OFFICER":
      return;
    case "DISTRICT_OFFICER":
      if (user.districtId && user.districtId === batch.districtId) return;
      break;
    case "CENTRE_OPERATOR":
      if (user.centreId && user.centreId === batch.centreId) return;
      break;
  }
  throw forbidden();
}
