import { prisma } from "../lib/db";
import { conflict, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { redis } from "../lib/redis";
import type { SessionUser } from "../types";
import { verifyCacheKey } from "./verifyService";
import { writeAudit } from "./txHelpers";

export async function cancelCertificate(user: SessionUser, number: string, reason: string) {
  if (user.role !== "STATE_OFFICER" && user.role !== "ADMIN") {
    throw forbidden("Only state officers can cancel certificates");
  }

  await prisma.$transaction(async (tx) => {
    // Lock the certificate row so two cancels cannot both succeed.
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM certificates WHERE number = ${number} FOR UPDATE`;
    if (rows.length === 0) throw notFound("Certificate not found");

    const certificate = await tx.certificate.findUniqueOrThrow({ where: { number } });
    if (certificate.status === "CANCELLED") throw conflict("Certificate is already cancelled");

    await tx.certificate.update({
      where: { number },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    await writeAudit(tx, {
      batchId: certificate.batchId,
      actorId: user.id,
      action: "CERTIFICATE_CANCELLED",
      details: { certificateId: certificate.id, reason },
    });
  });

  // Deleted only after the commit, so a reader cannot re-cache the old VALID row in between.
  try {
    await redis.del(verifyCacheKey(number));
  } catch (error) {
    logger.warn("verify cache delete failed; entry will expire on its own", { error: String(error) });
  }
}
