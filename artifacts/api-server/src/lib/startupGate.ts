import type { RequestListener } from "node:http";

export type StartupPhase = "booting" | "ready" | "failed";

export type StartupGate = {
  handler: RequestListener;
  activate(listener: RequestListener): void;
  fail(): void;
  getPhase(): StartupPhase;
};

function sendJson(
  res: Parameters<RequestListener>[1],
  statusCode: number,
  body: object,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload).toString(),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function pathname(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://startup.local").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

/**
 * Keeps the deployment port and liveness endpoints available while the full
 * application bundle and schema coordinator initialize. Business traffic is
 * never passed through until activate() installs the Express request listener.
 */
export function createStartupGate(): StartupGate {
  let phase: StartupPhase = "booting";
  let applicationListener: RequestListener | null = null;

  const handler: RequestListener = (req, res) => {
    if (phase === "ready" && applicationListener) {
      applicationListener(req, res);
      return;
    }

    const path = pathname(req.url);
    const isMethodSafe = req.method === "GET" || req.method === "HEAD";
    const isLiveness = path === "/api" || path === "/api/healthz";
    const isDeepHealth = path === "/api/health/deep";

    if (isMethodSafe && isLiveness && phase === "booting") {
      sendJson(res, 200, { status: "ok", phase });
      return;
    }

    if (isMethodSafe && isDeepHealth) {
      sendJson(
        res,
        503,
        {
          status: "degraded",
          phase,
          initialization: phase === "failed" ? "failed" : "in_progress",
        },
        { "retry-after": "5" },
      );
      return;
    }

    sendJson(
      res,
      503,
      {
        error: phase === "failed"
          ? "API initialization failed"
          : "API initialization in progress",
        phase,
      },
      { "retry-after": "5" },
    );
  };

  return {
    handler,
    activate(listener) {
      applicationListener = listener;
      phase = "ready";
    },
    fail() {
      applicationListener = null;
      phase = "failed";
    },
    getPhase() {
      return phase;
    },
  };
}