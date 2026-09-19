export type Http5xxRecord = {
  requestId: string;
  method: string;
  path: string;
  userId: string | null;
  status: number;
  message: string;
  stack: string;
};

type ErrorLogger = {
  error: (bindings: Record<string, unknown>, message: string) => void;
};

type Dependencies = {
  logger: ErrorLogger;
  persist: (record: Http5xxRecord) => Promise<unknown>;
};

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  return new Error(fallbackMessage);
}

/**
 * Records every completed HTTP 5xx response with the fields operators need to
 * correlate the UI error record with a structured server log. Route handlers
 * which send a 5xx response directly are observed on response completion;
 * unhandled errors pass their original Error here from the error middleware.
 */
export function createHttp5xxRecorder({ logger, persist }: Dependencies) {
  return {
    record(input: Omit<Http5xxRecord, "message" | "stack"> & { error?: unknown }): void {
      if (input.status < 500) return;

      const error = asError(input.error, `HTTP ${input.status} response completed`);
      const record: Http5xxRecord = {
        ...input,
        message: error.message,
        stack: error.stack || new Error(error.message).stack || "stack unavailable",
      };

      logger.error(record, "HTTP 5xx response");
      void persist(record).catch((persistError: unknown) => {
        const failure = asError(persistError, "Failed to write error_log");
        logger.error(
          {
            requestId: record.requestId,
            method: record.method,
            path: record.path,
            userId: record.userId,
            status: record.status,
            stack: failure.stack || new Error(failure.message).stack || "stack unavailable",
          },
          "Failed to write error_log",
        );
      });
    },
  };
}