import * as SentryNode from "@sentry/node";
import { logger } from "./logger";

let initialized = false;

export function initSentry(): void {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) {
    logger.info("SENTRY_DSN not set — Sentry error tracking disabled");
    return;
  }

  SentryNode.init({
    dsn,
    sendDefaultPii: false,
    maxRequestBodySize: "none",
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
  if (!initialized) return;
  SentryNode.withScope((scope) => {
    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        scope.setTag(key, value);
      }
    }
    SentryNode.captureException(err);
  });
}
