import { logger } from "./logger";

const NON_FATAL_PROCESS_ERROR = Symbol("workspace.api-server.nonFatalProcessError");

type Exit = (code: number) => void;

/**
 * Marks an error as safe to report without terminating the process.
 *
 * Unhandled errors are fatal by default. Callers must make the non-fatal
 * decision explicitly rather than relying on an error name or code that might
 * accidentally classify an unknown failure as safe.
 */
export function markNonFatal<T extends Error>(error: T): T {
  Object.defineProperty(error, NON_FATAL_PROCESS_ERROR, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return error;
}

export function isExplicitlyNonFatal(value: unknown): value is Error {
  return (
    value instanceof Error &&
    (value as unknown as Record<symbol, unknown>)[NON_FATAL_PROCESS_ERROR] ===
      true
  );
}

function describeUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    try {
      return String(value);
    } catch {
      return "<unprintable process failure>";
    }
  }
}

function asError(value: unknown, context: string): Error {
  if (value instanceof Error) return value;
  return new Error(`${context}: ${describeUnknown(value)}`);
}

function logFields(error: Error): { err: Error; stack: string } {
  return {
    err: error,
    stack: error.stack ?? `${error.name}: ${error.message}`,
  };
}

export function handleUnhandledRejection(
  reason: unknown,
  exit: Exit = (code) => process.exit(code),
): void {
  const error = asError(reason, "Unhandled promise rejection");
  if (isExplicitlyNonFatal(reason)) {
    logger.warn(
      logFields(error),
      "Non-fatal unhandled promise rejection; keeping process alive",
    );
    return;
  }

  logger.fatal(
    logFields(error),
    "FATAL: Unhandled promise rejection; exiting",
  );
  exit(1);
}

export function handleUncaughtException(
  errorValue: unknown,
  origin: string,
  exit: Exit = (code) => process.exit(code),
): void {
  const error = asError(errorValue, "Uncaught exception");
  if (isExplicitlyNonFatal(errorValue)) {
    logger.warn(
      { ...logFields(error), origin },
      "Non-fatal uncaught exception; keeping process alive",
    );
    return;
  }

  logger.fatal(
    { ...logFields(error), origin },
    "FATAL: Uncaught exception; exiting",
  );
  exit(1);
}

let handlersInstalled = false;

export function installProcessErrorHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("unhandledRejection", handleUnhandledRejection);
  process.on("uncaughtException", handleUncaughtException);
}