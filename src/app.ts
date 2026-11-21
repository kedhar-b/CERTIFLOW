import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { loadSession, requireAuth } from "./auth";
import { config } from "./config";
import { devLoginHandler, logoutHandler, meHandler } from "./controllers/authController";
import {
  addCandidatesHandler,
  approveHandler,
  createBatchHandler,
  getBatchHandler,
  rejectHandler,
  resubmitHandler,
  sendBackHandler,
  submitHandler,
} from "./controllers/batchController";
import { cancelHandler, publicKeyHandler, verifyHandler } from "./controllers/certificateController";
import { importHandler } from "./controllers/importHandler";
import { AppError } from "./lib/errors";
import { logger } from "./lib/logger";

type AsyncHandler = (req: Request, res: Response) => Promise<unknown> | unknown;

// Express 4 does not catch rejected promises, so every handler goes through this.
const wrap =
  (handler: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

const errorHandler: ErrorRequestHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid input", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) },
    });
    return;
  }
  logger.error("unhandled error", { error: String(error) });
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(config.SESSION_SECRET));
  app.use(loadSession);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Public: rate limited, returns no phone or email.
  const publicLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
  app.get("/verify/:number", publicLimiter, wrap(verifyHandler));
  app.get("/public-key", publicLimiter, publicKeyHandler);

  if (config.NODE_ENV !== "production") {
    app.post("/auth/dev-login", wrap(devLoginHandler));
  }
  app.post("/auth/logout", logoutHandler);
  app.get("/me", requireAuth, meHandler);

  app.post("/batches", requireAuth, wrap(createBatchHandler));
  app.get("/batches/:id", requireAuth, wrap(getBatchHandler));
  app.post("/batches/:id/candidates", requireAuth, wrap(addCandidatesHandler));
  // Moment 1: CSV import. express.text reads the body as a string only for text/csv; 1mb is the file-size cap.
  app.post("/batches/:id/import", requireAuth, express.text({ type: "text/csv", limit: "1mb" }), wrap(importHandler));
  app.post("/batches/:id/submit", requireAuth, wrap(submitHandler));
  app.post("/batches/:id/resubmit", requireAuth, wrap(resubmitHandler));
  app.post("/batches/:id/approve", requireAuth, wrap(approveHandler));
  app.post("/batches/:id/send-back", requireAuth, wrap(sendBackHandler));
  app.post("/batches/:id/reject", requireAuth, wrap(rejectHandler));

  app.post("/certificates/:number/cancel", requireAuth, wrap(cancelHandler));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  app.use(errorHandler);
  return app;
}