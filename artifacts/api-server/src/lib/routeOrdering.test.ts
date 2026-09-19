import assert from "node:assert/strict";
import test from "node:test";
import app, { clerkProxyHandler, globalClerkMiddleware } from "../app";
import router, { bootCriticalRouter, mutationAuthenticationGuard } from "../routes";
import healthRouter from "../routes/health";
import sendgridRouter from "../routes/sendgrid";
import { twilioProviderRouter } from "../routes/twilio";
import usfaIntakeRouter from "../routes/usfaIntake";

test("boot-critical routes precede Clerk and global validation middleware", () => {
  const appStack = (app as any)._router?.stack ?? (app as any).router?.stack;
  assert.ok(appStack, "Express app stack must be inspectable");
  const appIndex = (handle: unknown) =>
    appStack.findIndex((layer: any) => layer.handle === handle);
  const bootIndex = appIndex(bootCriticalRouter);
  assert.notEqual(bootIndex, -1, "boot-critical router must be mounted");
  const proxyIndex = appIndex(clerkProxyHandler);
  const clerkIndex = appIndex(globalClerkMiddleware);
  assert.notEqual(proxyIndex, -1, "Clerk proxy must be registered");
  assert.notEqual(clerkIndex, -1, "Clerk middleware must be registered");
  assert.equal(proxyIndex, 0, "Clerk proxy must precede every global Express middleware");
  assert.ok(proxyIndex < clerkIndex);
  assert.ok(bootIndex < clerkIndex);

  const stack = (router as any).stack as Array<{ handle: unknown }>;
  const indexOf = (handle: unknown) =>
    stack.findIndex((layer) => layer.handle === handle);
  const authIndex = indexOf(mutationAuthenticationGuard);

  assert.notEqual(authIndex, -1, "global mutation guard must be registered");
  const bootStack = (bootCriticalRouter as any).stack as Array<{ handle: unknown }>;
  for (const route of [healthRouter, sendgridRouter, twilioProviderRouter, usfaIntakeRouter]) {
    assert.ok(bootStack.some((layer) => layer.handle === route), "boot router contents must include provider route");
  }
});