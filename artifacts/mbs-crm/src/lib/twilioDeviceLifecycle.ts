export interface TokenLifecycleDevice {
  updateToken(token: string): void;
  register(): Promise<void> | void;
}

interface TokenLifecycleOptions {
  fetchToken: () => Promise<string>;
  getDevice: () => TokenLifecycleDevice | null;
  onError: (error: unknown) => void;
  maxAttempts?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function isRecoverableTwilioDeviceError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  const details: string[] = [];

  while (pending.length) {
    const value = pending.pop();
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number") {
      details.push(String(value));
      continue;
    }
    if (typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const candidate = value as Record<string, unknown>;
    for (const key of ["code", "name", "message", "description"]) {
      if (candidate[key] != null) pending.push(candidate[key]);
    }
    for (const key of ["causes", "twilioError", "innerError", "error"]) {
      const nested = candidate[key];
      if (Array.isArray(nested)) pending.push(...nested);
      else if (nested != null) pending.push(nested);
    }
  }

  return details.some((detail) =>
    /\b(?:20104|31205|1006)\b/.test(detail)
      || /access[\s_-]*token[\s_-]*expired/i.test(detail)
  );
}

export function createTwilioTokenLifecycle({
  fetchToken,
  getDevice,
  onError,
  maxAttempts = 3,
  wait = defaultWait,
}: TokenLifecycleOptions) {
  let disposed = false;
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  let reregisterRequested = false;

  const refresh = (reregister: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (inFlight) {
      if (reregister) reregisterRequested = true;
      return inFlight;
    }

    reregisterRequested = reregister;
    const currentGeneration = generation;
    const operation = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (disposed || generation !== currentGeneration) return;
        if (attempt > 0) await wait(250 * 2 ** (attempt - 1));
        if (disposed || generation !== currentGeneration) return;
        try {
          const token = await fetchToken();
          if (disposed || generation !== currentGeneration) return;
          const device = getDevice();
          if (!device) return;
          device.updateToken(token);
          if (reregisterRequested) await device.register();
          if (disposed || generation !== currentGeneration) return;
          return;
        } catch (error) {
          lastError = error;
        }
      }
      if (!disposed && generation === currentGeneration) onError(lastError);
    })();

    const wrappedOperation = operation.finally(() => {
      if (inFlight === wrappedOperation) {
        inFlight = null;
        reregisterRequested = false;
      }
    });
    inFlight = wrappedOperation;
    return wrappedOperation;
  };

  return {
    onTokenWillExpire: () => refresh(false),
    onRecoverableError: () => refresh(true),
    dispose: () => {
      disposed = true;
      generation += 1;
      inFlight = null;
    },
  };
}