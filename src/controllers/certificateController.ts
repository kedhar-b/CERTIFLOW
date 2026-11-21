import type { Request, Response } from "express";
import { z } from "zod";
import { requireUser } from "../auth";
import { CERTIFICATE_NUMBER_PATTERN, publicKeyPem } from "../lib/signing";
import { cancelCertificate } from "../services/certificateService";
import { verifyCertificate } from "../services/verifyService";

const numberParams = z.object({ number: z.string().regex(CERTIFICATE_NUMBER_PATTERN) });
const cancelBody = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function verifyHandler(req: Request, res: Response) {
  const parsed = numberParams.safeParse(req.params);
  // A malformed number can never exist, so skip the database and cache entirely.
  if (!parsed.success) {
    res.json({ status: "NOT_FOUND" });
    return;
  }
  res.json(await verifyCertificate(parsed.data.number));
}

export async function cancelHandler(req: Request, res: Response) {
  const { number } = numberParams.parse(req.params);
  const { reason } = cancelBody.parse(req.body);
  await cancelCertificate(requireUser(req), number, reason);
  res.json({ number, status: "CANCELLED" });
}

export function publicKeyHandler(_req: Request, res: Response) {
  res.type("text/plain").send(publicKeyPem());
}
