import test from "node:test";
import assert from "node:assert/strict";
import type { LeadListResponse } from "@workspace/api-client-react";
import { DESKTOP_LEADS_BATCH_SIZE, mergeLeadPages, nextLeadPage } from "./leadsScroll.ts";

test("desktop loads 50 at a time, stopping at the last or empty page", () => {
  assert.equal(DESKTOP_LEADS_BATCH_SIZE, 50);
  assert.equal(nextLeadPage(1, 12), 2);
  assert.equal(nextLeadPage(12, 12), undefined);
  assert.equal(nextLeadPage(1, 0), undefined);
  assert.equal(nextLeadPage(1, NaN), undefined);
});

test("scrolling appends records in order without duplicating moving records", () => {
  const page = (ids: number[]) => ({
    leads: ids.map(id => ({ id })), total: 577, totalPages: 12, page: 1,
  }) as LeadListResponse;
  assert.equal(mergeLeadPages([]), undefined);
  const merged = mergeLeadPages([page([1, 2]), page([2, 3])])!;
  assert.deepEqual(merged.leads.map(lead => lead.id), [1, 2, 3]);
  assert.equal(merged.total, 577);
  assert.deepEqual(mergeLeadPages([page([8])])!.leads.map(lead => lead.id), [8]);
});
