import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "./config";
import { roleSchema, type SessionUser } from "./types";
import { unauthorized } from "./lib/errors";

const COOKIE_NAME = "cf_session";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

const cookieSchema = z.object({
  id: z.string().min(1),
  role: roleSchema,
  districtId: z.string().nullable(),
  centreId: z.string().nullable(),
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function setSessionCookie(res: Response, user: SessionUser): void {
  res.cookie(COOKIE_NAME, JSON.stringify(user), {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME);
}

/** Identity comes only from the signed cookie. Request bodies and params are never trusted for it. */
export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  const raw: unknown = req.signedCookies?.[COOKIE_NAME];
  if (typeof raw === "string") {
    try {
      const parsed = cookieSchema.safeParse(JSON.parse(raw));
      if (parsed.success) req.user = parsed.data;
    } catch {
      // A malformed cookie is treated as no session.
    }
  }
  next();
}

export function requireUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  try {
    requireUser(req);
    next();
  } catch (error) {
    next(error);
  }
}
