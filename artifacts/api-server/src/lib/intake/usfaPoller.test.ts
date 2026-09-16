import assert from "node:assert/strict";
import test from "node:test";
import { USFA_HEADERS } from "./usfa";
import { validateUsfaHeaders, runUsfaSheetPoll } from "./usfaPoller";

test("USFA poller requires every exact vendor header", () => {
  assert.equal(validateUsfaHeaders([...USFA_HEADERS]), true);
  assert.equal(validateUsfaHeaders([...USFA_HEADERS].slice(0, -1)), false);
  assert.equal(validateUsfaHeaders(["Id", "COMPANY", "id"]), false);
});

test("USFA poller is safely disarmed when service-account secret is absent", async () => {
  const prior = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  try {
    const result = await runUsfaSheetPoll();
    assert.equal(result.status, "skipped");
    assert.match(result.reason ?? "", /GOOGLE_SERVICE_ACCOUNT_JSON/);
  } finally {
    if (prior === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = prior;
  }
});