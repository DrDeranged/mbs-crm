import assert from "node:assert/strict";
import test from "node:test";
import { approvalDaysUntil, approvalToCalculatorPrefill, latestApproval } from "./dealApproval.ts";

test("latest approval is deterministic by created time then id", () => {
  const selected = latestApproval([
    { id: 7, createdAt: "2026-09-17T10:00:00Z" },
    { id: 8, createdAt: "2026-09-17T10:00:00Z" },
    { id: 9, createdAt: "2026-09-16T10:00:00Z" },
  ]);
  assert.equal(selected?.id, 8);
});

test("adding Maxim approval, selecting latest, and opening calculator prefills fields", () => {
  const approvals: Array<{
    id: number;
    createdAt: string;
    advance: number;
    payment: number;
    term: number;
  }> = [];
  const addApproval = (approval: (typeof approvals)[number]) => {
    approvals.push(approval);
    return latestApproval(approvals);
  };
  addApproval({
    id: 3,
    createdAt: "2026-09-17T11:00:00Z",
    advance: 25000,
    payment: 1600,
    term: 18,
  });
  const selected = addApproval({
    id: 4,
    createdAt: "2026-09-17T12:00:00Z",
    advance: 28080,
    payment: 1735.69,
    term: 24,
  });
  assert.deepEqual(
    approvalToCalculatorPrefill(selected),
    { amount: "28080", payment: "1735.69", term: "24" },
  );
});

test("approval expiry reports whole days remaining", () => {
  assert.equal(approvalDaysUntil("2026-09-19", new Date("2026-09-17T14:00:00Z")), 2);
});