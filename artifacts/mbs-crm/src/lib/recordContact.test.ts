import test from "node:test";
import assert from "node:assert/strict";
import { emailActionTarget, isMobileWeb, phoneActionForDevice, softphoneReadyForAction } from "./recordContact.ts";

test("desktop phone uses softphone only when device is registered", () => {
  assert.equal(phoneActionForDevice(false, true), "softphone");
  assert.equal(phoneActionForDevice(false, false), "tel");
});

test("mobile web phone always uses tel even when a desktop device is registered", () => {
  assert.equal(phoneActionForDevice(true, true), "tel");
  assert.equal(phoneActionForDevice(true, false), "tel");
});

test("softphone must be registered and idle; active calls and incoming calls fall back to tel", () => {
  assert.equal(softphoneReadyForAction(true, "idle"), true);
  assert.equal(softphoneReadyForAction(true, "calling"), false);
  assert.equal(softphoneReadyForAction(true, "active"), false);
  assert.equal(softphoneReadyForAction(true, "incoming"), false);
  assert.equal(softphoneReadyForAction(false, "idle"), false);
  assert.equal(phoneActionForDevice(false, softphoneReadyForAction(true, "active")), "tel");
});

test("mobile web detection handles narrow viewports and mobile device landscape", () => {
  assert.equal(isMobileWeb({ userAgent: "Desktop", viewportWidth: 375 }), true);
  assert.equal(isMobileWeb({ userAgent: "iPhone", viewportWidth: 1000 }), true);
  assert.equal(isMobileWeb({ userAgent: "Desktop", viewportWidth: 1000, pointerCoarse: true }), true);
  assert.equal(isMobileWeb({ userAgent: "Desktop", viewportWidth: 1280, pointerCoarse: false }), false);
});

test("email opens CRM composer for linked lead and mailto otherwise", () => {
  assert.deepEqual(emailActionTarget("rep@example.com", 15), {
    kind: "composer",
    href: "/leads/15?compose=email",
  });
  assert.deepEqual(emailActionTarget("rep@example.com", null), {
    kind: "mailto",
    href: "mailto:rep@example.com",
  });
  assert.deepEqual(emailActionTarget("rep@example.com"), {
    kind: "mailto",
    href: "mailto:rep@example.com",
  });
  assert.deepEqual(emailActionTarget("rep@example.com", 15, false), {
    kind: "mailto",
    href: "mailto:rep@example.com",
  });
});