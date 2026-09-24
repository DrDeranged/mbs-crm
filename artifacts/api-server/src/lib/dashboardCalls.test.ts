import assert from "node:assert/strict";
import test from "node:test";
import { calculateDashboardCalls } from "./dashboardCalls";

test("calls card fixture counts two voicemails, one callback, and one overdue record", () => {
  const settings = {
    voiceHoursStart: "08:00",
    voiceHoursEnd: "18:00",
    voiceBusinessDays: [1, 2, 3, 4, 5],
    voiceHolidays: [],
  };
  const inbound = [
    { id: 1, leadId: 11, createdAt: new Date("2025-01-06T14:00:00Z"), direction: "inbound" as const, status: "completed", callOutcome: "voicemail" },
    { id: 2, leadId: 12, createdAt: new Date("2025-01-06T14:00:00Z"), direction: "inbound" as const, status: "completed", callOutcome: "voicemail" },
    { id: 3, leadId: 13, createdAt: new Date("2025-01-06T15:00:00Z"), direction: "inbound" as const, status: "completed", callOutcome: "connected" },
  ];
  const callbacks = [{
    id: 4, leadId: 11, createdAt: new Date("2025-01-06T16:00:00Z"), direction: "outbound" as const,
    status: "completed", callOutcome: "connected", userRole: "rep",
    callbackActivityAt: new Date("2025-01-06T16:00:00Z"), callbackActivityStatus: "completed",
  }, {
    id: 5, leadId: 11, createdAt: new Date("2025-01-06T17:00:00Z"), direction: "outbound" as const,
    status: "completed", callOutcome: "connected", userRole: "rep",
    callbackActivityAt: new Date("2025-01-06T17:00:00Z"), callbackActivityStatus: "completed",
  }];
  const result = calculateDashboardCalls(inbound, [
    { ...inbound[0]! },
    { ...inbound[1]!, createdAt: new Date("2025-01-03T14:00:00Z") },
  ], callbacks, [
    { id: 11, firstName: "Callback", lastName: "Lead", companyName: null, phone: "+15550000011" },
    { id: 12, firstName: "Overdue", lastName: "Lead", companyName: null, phone: "+15550000012" },
    { id: 13, firstName: "Answered", lastName: "Lead", companyName: null, phone: "+15550000013" },
  ], settings, new Date("2025-01-06T23:00:00Z"));

  assert.equal(result.inboundCount, 3);
  assert.equal(result.answeredCount, 1);
  assert.equal(result.voicemailCount, 2);
  assert.equal(result.averageCallbackBusinessMinutes, 120);
  assert.equal(result.overdueVoicemails.length, 1);
  assert.equal(result.overdueVoicemails[0]?.leadId, 12);
});