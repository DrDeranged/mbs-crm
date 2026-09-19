/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import { createProxyMiddleware } from "http-proxy-middleware";
import type { Request, RequestHandler, Response } from "express";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "http";
import { logger } from "../lib/logger";

export const LEGACY_CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkKeyPrefix(value: string | undefined): string {
  return value?.match(/^(?:pk|sk)_(?:live|test)_/)?.[0].slice(0, -1) ?? "unknown";
}

export function getClerkFapiOrigin(
  publishableKey = process.env.CLERK_PUBLISHABLE_KEY,
): string {
  const payload = publishableKey?.match(/^pk_(?:live|test)_(.+)$/)?.[1];
  if (!payload) return LEGACY_CLERK_FAPI;

  try {
    const hostname = Buffer.from(payload, "base64url")
      .toString("utf8")
      .replace(/\$$/, "")
      .toLowerCase();
    const validHostname =
      hostname.length <= 253 &&
      hostname.includes(".") &&
      !hostname.includes("..") &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(hostname);
    return validHostname ? `https://${hostname}` : LEGACY_CLERK_FAPI;
  } catch {
    return LEGACY_CLERK_FAPI;
  }
}

/**
 * Returns the first effective public hostname for the given request,
 * preferring x-forwarded-host over the Host header so callers behind a
 * proxy see the original client-facing host.
 *
 * x-forwarded-host can take three shapes:
 *   - undefined (no proxy involved)
 *   - a single string (one proxy hop)
 *   - a comma-delimited string when an upstream appended rather than
 *     replaced the header (Node folds duplicate headers this way), or a
 *     string[] in some Express typings
 * In the multi-value case, the leftmost value is the original client-
 * facing host. Take that one in all forms. Exported so that app.ts
 * (clerkMiddleware callback) and this proxy middleware agree on which
 * hostname is canonical — otherwise multi-domain/custom-domain flows
 * break.
 */
export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware({
  env = process.env,
  log = logger,
  proxyFactory = createProxyMiddleware,
}: {
  env?: NodeJS.ProcessEnv;
  log?: Pick<typeof logger, "error" | "fatal" | "info">;
  proxyFactory?: typeof createProxyMiddleware;
} = {}): RequestHandler {
  const upstreamOrigin = getClerkFapiOrigin(env.CLERK_PUBLISHABLE_KEY);
  log.info(
    {
      clerkFapiHost: new URL(upstreamOrigin).host,
      publishableKeyPrefix: getClerkKeyPrefix(env.CLERK_PUBLISHABLE_KEY),
      secretKeyPrefix: getClerkKeyPrefix(env.CLERK_SECRET_KEY),
    },
    "Clerk production proxy FAPI host resolved",
  );

  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = env.CLERK_SECRET_KEY;
  if (!secretKey) {
    log.fatal(
      { missingVariable: "CLERK_SECRET_KEY" },
      "Clerk production proxy is disabled because CLERK_SECRET_KEY is missing",
    );
    return (_req, _res, next) => next();
  }

  const redactHeaders = (headers: IncomingHttpHeaders): OutgoingHttpHeaders => {
    const safe = { ...headers };
    for (const name of ["authorization", "cookie", "set-cookie"]) {
      if (safe[name] !== undefined) safe[name] = "[redacted]";
    }
    return safe;
  };
  const context = (
    req: Request,
    status: number | undefined,
    headers: IncomingHttpHeaders | undefined,
  ) => ({
    requestPath: req.originalUrl || req.url,
    upstreamUrl: new URL(req.url || "/", upstreamOrigin).toString(),
    upstreamStatus: status ?? null,
    upstreamResponseHeaders: headers ? redactHeaders(headers) : null,
  });
  const errorStatus = (error: unknown): number | undefined => {
    if (!error || typeof error !== "object") return undefined;
    const candidate = "statusCode" in error
      ? error.statusCode
      : "status" in error
        ? error.status
        : undefined;
    return typeof candidate === "number" ? candidate : undefined;
  };
  const failedResponses = new WeakSet<Response>();
  const fail = (
    req: Request,
    res: Response,
    error: unknown,
    status?: number,
    headers?: IncomingHttpHeaders,
  ) => {
    if (failedResponses.has(res)) return;
    failedResponses.add(res);
    const responseStatus = status && status >= 400 && status <= 599 ? status : 502;
    log.error(
      { ...context(req, status, headers), err: error },
      "Clerk upstream proxy request failed",
    );
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const reason = "Clerk upstream request failed";
    res.status(responseStatus).type("text/plain").send(reason);
  };

  const proxy = proxyFactory({
    target: upstreamOrigin,
    changeOrigin: true,
    // The deployment edge rejects chunked proxied responses. Handle the
    // upstream response so every body has an explicit Content-Length.
    selfHandleResponse: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const xff = req.headers["x-forwarded-for"];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          "";
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
      proxyRes: (proxyRes, req, res) => {
        const expressReq = req as Request;
        const expressRes = res as Response;
        const headers = { ...proxyRes.headers };
        delete headers["transfer-encoding"];
        delete headers.connection;
        delete headers["keep-alive"];

        const status = proxyRes.statusCode ?? 502;
        if (status >= 400) {
          proxyRes.resume();
          fail(
            expressReq,
            expressRes,
            new Error(`Clerk upstream returned HTTP ${status}`),
            status,
            proxyRes.headers,
          );
          return;
        }
        if (status < 200 || status === 204) {
          delete headers["content-length"];
        }

        const bodyless =
          req.method === "HEAD" ||
          status < 200 ||
          status === 204 ||
          status === 304;
        if (headers["content-length"] !== undefined || bodyless) {
          res.writeHead(status, headers);
          proxyRes.on("error", (error) => {
            fail(expressReq, expressRes, error, status, proxyRes.headers);
          });
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on("error", (error) => {
          fail(expressReq, expressRes, error, status, proxyRes.headers);
        });
      },
      error: (error, req, res) => {
        fail(req as Request, res as Response, error, errorStatus(error));
      },
    },
  }) as RequestHandler;

  return (req, res, next) => {
    try {
      proxy(req, res, (error) => {
        if (error) fail(req, res, error, errorStatus(error));
        else next();
      });
    } catch (error) {
      fail(req, res, error, errorStatus(error));
    }
  };
}
