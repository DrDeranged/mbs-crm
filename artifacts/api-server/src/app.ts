import crypto from "crypto";
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
import router from "./routes";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { errorLogTable } from "@workspace/db";

const app: Express = express();

// Attach a unique request id to every request
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = crypto.randomUUID();
  next();
});

app.use(
  pinoHttp({
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
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(compression());

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

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

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const requestId = req.requestId ?? "unknown";
  const { userId } = getAuth(req);

  const status =
    (err instanceof Error && "status" in err ? (err as any).status : null) ??
    (err instanceof Error && "statusCode" in err ? (err as any).statusCode : null) ??
    500;

  const message = err instanceof Error ? err.message : "Internal server error";
  const stack = err instanceof Error ? err.stack : undefined;

  logger.error(
    {
      requestId,
      method: req.method,
      path: req.url?.split("?")[0],
      userId: userId ?? null,
      status,
      message,
      stack,
    },
    "Unhandled error",
  );

  // Fire-and-forget: only log 500-level errors to DB, never block the response
  if (status >= 500) {
    db.insert(errorLogTable)
      .values({
        requestId,
        userId: userId ?? null,
        method: req.method,
        path: req.url?.split("?")[0] ?? req.url,
        status,
        message,
        stack: stack ?? null,
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, "Failed to write to error_log");
      });
  }

  res.status(status).json({ error: message, requestId });
});

export default app;
