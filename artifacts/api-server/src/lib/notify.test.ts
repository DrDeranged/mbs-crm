import assert from "node:assert/strict";
import test from "node:test";
import { deliverNotification } from "./notify";

test("notification delivery attempts Expo and web channels independently", async () => {
  const attempted: string[] = [];
  await deliverNotification({
    userId: 7, type: "status_changed", title: "Status", body: "Changed",
  }, {
    expo: async () => { attempted.push("expo"); throw new Error("Expo unavailable"); },
    web: async () => { attempted.push("web"); throw new Error("web unavailable"); },
  });
  // deliverNotification intentionally does not make best-effort channels part
  // of the request transaction; allow both promise callbacks to start.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(attempted.sort(), ["expo", "web"]);
});