import assert from "node:assert/strict";
import test from "node:test";
import { recordManualLenderSubmission } from "./manualLenderSubmission";

test("manual submission persists source manual and writes its activity", async () => {
  const inserted: any[] = [];
  const activities: any[] = [];
  const row = await recordManualLenderSubmission({
    insert: async (values) => {
      inserted.push(values);
      return { id: 41, status: values.status };
    },
    logActivity: async (params) => { activities.push(params); },
  }, {
    leadId: 7,
    dealId: 9,
    lenderId: 12,
    sentBy: 3,
    status: "submitted",
    notes: "Sent in lender portal",
    sentAt: new Date("2026-09-17T12:00:00.000Z"),
    decisionDate: null,
    approvalAttachmentKey: null,
  });

  assert.equal(row.id, 41);
  assert.equal(inserted[0].source, "manual");
  assert.deepEqual(activities, [{
    userId: 3,
    leadId: 7,
    dealId: 9,
    action: "lender_submission_logged",
    entityType: "lender_submission",
    entityId: 41,
    details: { source: "manual", status: "submitted" },
  }]);
});