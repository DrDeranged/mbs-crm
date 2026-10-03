// Test-only prerequisite check. Never log credentials, tickets or user data.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { clerkClient } = require("@clerk/express");
if (!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("Synthetic Clerk writes require development test credentials; no user was created.");
}
let user;
try {
  user = await clerkClient.users.createUser({
    firstName: "Visual",
    lastName: "Fixture",
    emailAddress: [`visual-fixture-${Date.now()}@example.com`],
    skipPasswordRequirement: true,
  });
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 60 });
  if (!ticket.token) throw new Error("Clerk returned no sign-in ticket.");
  console.log("Development synthetic user and sign-in ticket creation: PASS (no credentials saved)");
} catch (error) {
  console.error("Development synthetic authentication probe failed:", error?.status ?? "unknown status",
    error?.errors?.map(({ code }) => code).join(", ") ?? error?.message);
  process.exitCode = 1;
} finally {
  if (user) await clerkClient.users.deleteUser(user.id);
}