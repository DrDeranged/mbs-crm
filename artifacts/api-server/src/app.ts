import crypto from "crypto";
import { initSentry, captureException } from "./lib/sentry";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router, { bootCriticalRouter } from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { errorLogTable } from "@workspace/db";
import { getSafeUserId } from "./lib/requestAuth";
import { createHttp5xxRecorder } from "./lib/httpErrorObservation";
import { buildRevision, REVISION_HEADER } from "./lib/buildRevision";

initSentry();

const app: Express = express();
export const clerkProxyHandler = clerkProxyMiddleware();

const recordHttp5xx = createHttp5xxRecorder({
  logger,
  persist: async (record) => {
    await db.insert(errorLogTable).values(record);
  },
});

function observeHttp5xx(req: Request, res: Response, error?: unknown): void {
  if (res.statusCode < 500 || res.locals.http5xxObserved) return;
  res.locals.http5xxObserved = true;
  recordHttp5xx.record({
    requestId: req.requestId ?? "unknown",
    method: req.method,
    path: req.url?.split("?")[0] ?? req.url,
    userId: getSafeUserId(() => getAuth(req)) ?? null,
    status: res.statusCode,
    error,
  });
}

// Replit routes requests through one trusted proxy hop. This lets middleware
// such as express-rate-limit derive the originating client IP safely.
app.set("trust proxy", 1);

// Attach a unique request id to every request
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  req.requestId = crypto.randomUUID();
  res.setHeader(REVISION_HEADER, buildRevision);
  next();
};
app.use(requestIdMiddleware);

export const requestLoggingMiddleware = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId,
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url?.split("?")[0],
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
app.use(requestLoggingMiddleware);

// The Clerk asset/FAPI proxy must remain immediately after observability and
// before application auth, validation, parsing, security-header, compression,
// or rate-limit middleware.
app.use(CLERK_PROXY_PATH, clerkProxyHandler);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());

const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

if (isProduction && allowedOrigins.length === 0) {
  logger.warn("ALLOWED_ORIGINS is not set in production — all CORS origins will be rejected");
}

app.use(
  cors({
    credentials: true,
    origin: isProduction
      ? (allowedOrigins.length > 0 ? allowedOrigins : false)
      : true,
  }),
);

app.use(
  express.json({
    limit: "10mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

// These routes must run before Clerk auth/validation. Provider callbacks use
// their own signature checks and health/proxy probes must remain unauthenticated.
app.use("/api", bootCriticalRouter);

export const globalClerkMiddleware = clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  }));
app.use(globalClerkMiddleware);

// Handlers which intentionally catch an error and send a 5xx response still
// need structured log/error-log coverage. Unhandled errors are recorded below
// with their original stack before their response completes.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.once("finish", () => observeHttp5xx(req, res));
  next();
});

app.use("/api", router);

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status =
    (err instanceof Error && "status" in err ? (err as any).status : null) ??
    (err instanceof Error && "statusCode" in err ? (err as any).statusCode : null) ??
    500;

  // Report 500-level errors to Sentry with the request_id tag
  if (status >= 500) {
    captureException(err, { request_id: req.requestId ?? "unknown" });
  }

  res.status(status);
  observeHttp5xx(req, res, err);
  res.json({ error: err instanceof Error ? err.message : "Internal server error", requestId: req.requestId ?? "unknown" });
});

export default app;
