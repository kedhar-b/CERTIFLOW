import type { Request, Response } from "express";
import { z } from "zod";
import { clearSessionCookie, requireUser, setSessionCookie } from "../auth";
import { prisma } from "../lib/db";
import { unauthorized } from "../lib/errors";

const devLoginBody = z.object({ email: z.string().email() });

/**
 * Development and test only (the route is not mounted in production).
 * Replace with real authentication before go-live; everything else reads identity from the cookie it sets.
 */
export async function devLoginHandler(req: Request, res: Response) {
  const { email } = devLoginBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw unauthorized("Unknown user");

  setSessionCookie(res, { id: user.id, role: user.role, districtId: user.districtId, centreId: user.centreId });
  res.json({ id: user.id, role: user.role });
}

export function logoutHandler(_req: Request, res: Response) {
  clearSessionCookie(res);
  res.status(204).end();
}

export function meHandler(req: Request, res: Response) {
  const user = requireUser(req);
  res.json({ id: user.id, role: user.role, districtId: user.districtId, centreId: user.centreId });
}
