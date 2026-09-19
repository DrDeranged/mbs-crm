import { getClerkFapiOrigin } from "../middlewares/clerkProxyMiddleware";

export type ClerkIntegrationHealth = {
  secretKey: boolean;
  publishableKey: boolean;
  proxyReachable: boolean;
};

export function createClerkHealthProbe({
  env = () => process.env,
  request = (url: string, signal: AbortSignal) =>
    fetch(url, { method: "HEAD", signal }),
  now = Date.now,
  timeoutMs = 3_000,
  cacheMs = 10 * 60 * 1_000,
}: {
  env?: () => NodeJS.ProcessEnv;
  request?: (url: string, signal: AbortSignal) => Promise<unknown>;
  now?: () => number;
  timeoutMs?: number;
  cacheMs?: number;
} = {}) {
  let cached: { until: number; value: ClerkIntegrationHealth } | undefined;
  let inFlight: Promise<ClerkIntegrationHealth> | undefined;

  async function inspect(): Promise<ClerkIntegrationHealth> {
    const values = env();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let proxyReachable = false;
    try {
      await request(getClerkFapiOrigin(), controller.signal);
      proxyReachable = true;
    } catch {
      proxyReachable = false;
    } finally {
      clearTimeout(timer);
    }
    return {
      secretKey: !!values.CLERK_SECRET_KEY,
      publishableKey: !!values.CLERK_PUBLISHABLE_KEY,
      proxyReachable,
    };
  }

  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.value);
    if (!inFlight) {
      inFlight = inspect()
        .then((value) => {
          cached = { value, until: now() + cacheMs };
          return value;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };
}

export const getClerkHealth = createClerkHealthProbe();