import { newYorkBusinessTime } from "./inboundVoice";

export interface DashboardCallRow {
  id: number;
  leadId: number | null;
  createdAt: Date;
  direction: "inbound" | "outbound";
  status: string;
  callOutcome: string | null;
  userRole?: string | null;
  callbackActivityAt?: Date | null;
  callbackActivityStatus?: string | null;
}

export interface DashboardCallLead {
  id: number;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
}

export interface DashboardCallSettings {
  voiceHoursStart: string;
  voiceHoursEnd: string;
  voiceBusinessDays: number[];
  voiceHolidays: string[];
}

export function businessMinutes(from: Date, to: Date, settings: DashboardCallSettings): number {
  if (to <= from) return 0;
  let total = 0;
  for (let cursor = new Date(from); cursor < to; cursor = new Date(cursor.getTime() + 60_000)) {
    const local = newYorkBusinessTime(cursor);
    if (
      settings.voiceBusinessDays.includes(local.day) &&
      !settings.voiceHolidays.includes(local.date) &&
      local.time >= settings.voiceHoursStart &&
      local.time < settings.voiceHoursEnd
    ) total++;
  }
  return total;
}

export function calculateDashboardCalls(
  inboundToday: DashboardCallRow[],
  voicemailRows: DashboardCallRow[],
  callbacks: DashboardCallRow[],
  leads: DashboardCallLead[],
  settings: DashboardCallSettings,
  now: Date,
) {
  const leadById = new Map(leads.map((lead) => [lead.id, lead]));
  const callbackMinutes: number[] = [];
  const overdueVoicemails = voicemailRows
    .filter((call) => call.status === "voicemail" || call.callOutcome === "voicemail")
    .flatMap((voicemail) => {
      const callback = callbacks
        .filter((candidate) =>
          candidate.leadId === voicemail.leadId &&
          (candidate.callbackActivityAt ?? candidate.createdAt) > voicemail.createdAt &&
          candidate.direction === "outbound" &&
          candidate.userRole === "rep" &&
          ["completed", "answered", "connected"].includes(candidate.callbackActivityStatus ?? ""),
        )
        .sort((a, b) =>
          (a.callbackActivityAt ?? a.createdAt).getTime() - (b.callbackActivityAt ?? b.createdAt).getTime(),
        )[0];
      if (callback) {
        callbackMinutes.push(businessMinutes(voicemail.createdAt, callback.callbackActivityAt!, settings));
        return [];
      }
      if (businessMinutes(voicemail.createdAt, now, settings) < 4 * 60) return [];
      const lead = leadById.get(voicemail.leadId ?? -1);
      if (!lead) return [];
      return [{
        id: voicemail.id,
        leadId: lead.id,
        leadName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.companyName || `Lead #${lead.id}`,
        companyName: lead.companyName,
        phone: lead.phone,
        arrivedAt: voicemail.createdAt.toISOString(),
      }];
    });
  const answeredCount = inboundToday.filter((call) =>
    call.callOutcome !== "voicemail" &&
    (call.callOutcome === "connected" || call.status === "completed" || call.status === "answered"),
  ).length;
  return {
    inboundCount: inboundToday.length,
    answeredCount,
    voicemailCount: inboundToday.filter((call) => call.status === "voicemail" || call.callOutcome === "voicemail").length,
    averageCallbackBusinessMinutes: callbackMinutes.length
      ? Math.round(callbackMinutes.reduce((sum, value) => sum + value, 0) / callbackMinutes.length)
      : null,
    overdueVoicemails,
  };
}