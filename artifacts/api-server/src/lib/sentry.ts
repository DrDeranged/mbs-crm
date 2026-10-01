import { logger } from "./logger";

type SentryModule = typeof import("@sentry/node");
type SentryModuleLoader = () => Promise<SentryModule>;

let initialized = false;
let SentryNode: SentryModule | undefined;

export async function initSentry(options: {
  env?: NodeJS.ProcessEnv;
  loadSentry?: SentryModuleLoader;
} = {}): Promise<void> {
  const dsn = (options.env ?? process.env)["SENTRY_DSN"];
  if (!dsn) {
    logger.info("SENTRY_DSN not set — Sentry error tracking disabled");
    return;
  }

  SentryNode = await (options.loadSentry ?? (() => import("@sentry/node")))();
  SentryNode.init({
    dsn,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });

  initialized = true;
  logger.info("Sentry error tracking initialized");
}

export function captureException(err: unknown, tags?: Record<string, string>): void {
  const sentryNode = SentryNode;
  if (!initialized || !sentryNode) return;
  sentryNode.withScope((scope) => {
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        scope.setTag(key, value);
      }
    }
    sentryNode.captureException(err);
  });
}
