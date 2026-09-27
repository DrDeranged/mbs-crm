import assert from "node:assert/strict";
import test from "node:test";
import {
  createTwilioTokenLifecycle,
  isRecoverableTwilioDeviceError,
  type TokenLifecycleDevice,
} from "./twilioDeviceLifecycle.ts";

function fakeDevice() {
  const updates: string[] = [];
  let registrations = 0;
  const device: TokenLifecycleDevice = {
    updateToken: (token) => updates.push(token),
    register: () => { registrations += 1; },
  };
  return { device, updates, registrations: () => registrations };
}

test("refreshes the device token when a simulated short-TTL token nears expiry", async () => {
  const fake = fakeDevice();
  let tokenRequests = 0;
  const lifecycle = createTwilioTokenLifecycle({
    fetchToken: async () => `fresh-token-${++tokenRequests}`,
    getDevice: () => fake.device,
    onError: (error) => assert.fail(`unexpected refresh error: ${String(error)}`),
  });

  // Simulate the SDK's tokenWillExpire event shortly after registration.
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      void lifecycle.onTokenWillExpire().then(resolve);
    }, 5);
  });

  assert.equal(tokenRequests, 1);
  assert.deepEqual(fake.updates, ["fresh-token-1"]);
  assert.equal(fake.registrations(), 0);
  lifecycle.dispose();
});

test("expired tokens and abnormal socket closes update the token and re-register once", async () => {
  const fake = fakeDevice();
  let tokenRequests = 0;
  const lifecycle = createTwilioTokenLifecycle({
    fetchToken: async () => `recovery-${++tokenRequests}`,
    getDevice: () => fake.device,
    onError: (error) => assert.fail(`unexpected recovery error: ${String(error)}`),
    wait: async () => {},
  });

  assert.equal(isRecoverableTwilioDeviceError({ code: 20104 }), true);
  assert.equal(isRecoverableTwilioDeviceError({ code: 31205 }), true);
  assert.equal(isRecoverableTwilioDeviceError({ message: "WebSocket closed with code 1006" }), true);
  assert.equal(isRecoverableTwilioDeviceError({
    causes: [{ message: "AccessTokenExpired", detail: { code: 20104 } }],
  }), true);
  assert.equal(isRecoverableTwilioDeviceError({ error: { message: "WebSocket close code 1006" } }), true);
  assert.equal(isRecoverableTwilioDeviceError({ code: 99999 }), false);

  await Promise.all([
    lifecycle.onRecoverableError(),
    lifecycle.onRecoverableError(),
  ]);
  assert.equal(tokenRequests, 1);
  assert.deepEqual(fake.updates, ["recovery-1"]);
  assert.equal(fake.registrations(), 1);
  lifecycle.dispose();
});

test("upgrades an in-flight expiry refresh when recovery requires re-registration", async () => {
  const fake = fakeDevice();
  let resolveToken: ((token: string) => void) | undefined;
  let tokenRequests = 0;
  const lifecycle = createTwilioTokenLifecycle({
    fetchToken: () => {
      tokenRequests += 1;
      return new Promise<string>((resolve) => { resolveToken = resolve; });
    },
    getDevice: () => fake.device,
    onError: (error) => assert.fail(`unexpected recovery error: ${String(error)}`),
    wait: async () => {},
  });

  const expiryRefresh = lifecycle.onTokenWillExpire();
  const recoveryRefresh = lifecycle.onRecoverableError();
  assert.equal(tokenRequests, 1);
  resolveToken?.("fresh-recovery-token");
  await Promise.all([expiryRefresh, recoveryRefresh]);

  assert.deepEqual(fake.updates, ["fresh-recovery-token"]);
  assert.equal(fake.registrations(), 1);
  lifecycle.dispose();
});

test("recovery retries are bounded and report the final error", async () => {
  const fake = fakeDevice();
  const errors: unknown[] = [];
  let attempts = 0;
  const lifecycle = createTwilioTokenLifecycle({
    fetchToken: async () => {
      attempts += 1;
      throw new Error("temporary token endpoint failure");
    },
    getDevice: () => fake.device,
    onError: (error) => errors.push(error),
    maxAttempts: 3,
    wait: async () => {},
  });

  await lifecycle.onRecoverableError();
  assert.equal(attempts, 3);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /temporary token endpoint failure/);
  assert.deepEqual(fake.updates, []);
  assert.equal(fake.registrations(), 0);
  lifecycle.dispose();
});