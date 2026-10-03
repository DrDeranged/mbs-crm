const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveDeploymentDomain } = require("./deployment-domain.cjs");

test("release default ignores deployment and development auto-domains", () => {
  assert.equal(resolveDeploymentDomain({
    REPLIT_INTERNAL_APP_DOMAIN: "mbs-arslandin.replit.app",
    REPLIT_DEV_DOMAIN: "preview.replit.dev",
  }), "app.my-business-solutions.com");
});
test("explicit public host wins and protocols are normalized", () => {
  assert.equal(resolveDeploymentDomain({ EXPO_PUBLIC_DOMAIN: "https://app.my-business-solutions.com" }), "app.my-business-solutions.com");
  assert.equal(resolveDeploymentDomain({ EXPO_PUBLIC_DOMAIN: "preview.replit.dev" }), "preview.replit.dev");
});
test("rejects API paths instead of generating incorrect origins", () => {
  assert.throws(() => resolveDeploymentDomain({ EXPO_PUBLIC_DOMAIN: "https://example.com/api" }));
});