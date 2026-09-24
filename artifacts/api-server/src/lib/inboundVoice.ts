import twilio from "twilio";

export interface VoiceHours {
  voiceHoursStart: string;
  voiceHoursEnd: string;
  voiceBusinessDays: number[];
  voiceHolidays: string[];
}

/** JS weekday (Sunday=0), local date, and wall-clock time in New York. */
export function newYorkBusinessTime(now: Date): { day: number; date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    day,
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function isWithinVoiceHours(settings: VoiceHours, now = new Date()): boolean {
  const local = newYorkBusinessTime(now);
  return settings.voiceBusinessDays.includes(local.day)
    && !settings.voiceHolidays.includes(local.date)
    && local.time >= settings.voiceHoursStart
    && local.time < settings.voiceHoursEnd;
}

export interface RingTarget {
  id: number;
  forwardingNumber: string | null;
  isActive: boolean;
  role: string;
  mergedInto?: number | null;
}

export function selectRingTargets(
  reps: RingTarget[],
  assignedRepId: number | null,
  mode: "assigned-rep-first" | "ring-all" | "priority-list",
  priorityRepIds: number[] = [],
): RingTarget[] {
  const active = reps.filter((rep) =>
    rep.isActive && rep.mergedInto == null && ["rep", "manager", "admin"].includes(rep.role) && Boolean(rep.forwardingNumber));
  if (mode === "priority-list") {
    const eligible = new Map(active.filter((rep) => rep.role === "rep").map((rep) => [rep.id, rep]));
    return [...new Set(priorityRepIds)].flatMap((id) => {
      const rep = eligible.get(id);
      return rep ? [rep] : [];
    });
  }
  if (mode === "assigned-rep-first" && assignedRepId != null) {
    const assigned = active.find((rep) => rep.id === assignedRepId);
    if (assigned) return [assigned];
  }
  return active.filter((rep) => rep.role === "rep");
}

export function nextPriorityTarget(targets: RingTarget[], attempt: number, dialStatus: string): RingTarget | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= targets.length) return null;
  if (dialStatus === "completed" || dialStatus === "answered") return null;
  return targets[attempt + 1] ?? null;
}

export interface VoicePromptOptions {
  baseUrl: string;
  greeting: string;
  afterHoursGreeting: string;
  greetingAudioUrl?: string;
  afterHoursGreetingAudioUrl?: string;
}

export function appendVoiceMessage(
  response: InstanceType<typeof twilio.twiml.VoiceResponse>,
  options: VoicePromptOptions,
  afterHours: boolean,
): void {
  const audio = afterHours ? options.afterHoursGreetingAudioUrl : options.greetingAudioUrl;
  if (audio) response.play(audio);
  else response.say({ voice: "Polly.Joanna" } as any,
    afterHours ? options.afterHoursGreeting : options.greeting);
  response.record({
    maxLength: 120,
    playBeep: true,
    trim: "trim-silence",
    transcribe: true,
    transcriptionCallback: `${options.baseUrl}/api/twilio/voice/transcription`,
    recordingStatusCallback: `${options.baseUrl}/api/twilio/voice/voicemail-complete`,
    recordingStatusCallbackMethod: "POST",
    action: `${options.baseUrl}/api/twilio/voice/voicemail-finished`,
    method: "POST",
  } as any);
}

export function buildInboundVoiceTwiML(options: VoicePromptOptions & {
  open: boolean;
  targets: RingTarget[];
  callerId: string;
  callSid: string;
  routingMode?: "assigned-rep-first" | "ring-all" | "priority-list";
  priorityAttempt?: number;
}): string {
  const response = new twilio.twiml.VoiceResponse();
  if (options.open && options.targets.length) {
    const dial = response.dial({
      timeout: options.routingMode === "priority-list" ? 15 : 20,
      callerId: options.callerId,
      action: `${options.baseUrl}/api/twilio/voice/dial-result${options.routingMode === "priority-list" ? `?attempt=${options.priorityAttempt ?? 0}` : ""}`,
      method: "POST",
      answerOnBridge: true,
      record: "record-from-answer",
      recordingStatusCallback: `${options.baseUrl}/api/twilio/voice/recording`,
      recordingStatusCallbackMethod: "POST",
    } as any);
    for (const rep of options.routingMode === "priority-list" ? options.targets.slice(0, 1) : options.targets) {
      const callback = `${options.baseUrl}/api/twilio/voice/status?repId=${rep.id}&parentCallSid=${encodeURIComponent(options.callSid)}`;
      dial.number({
        statusCallback: callback,
        statusCallbackMethod: "POST",
      } as any, rep.forwardingNumber!);
      dial.client({
        statusCallback: callback,
        statusCallbackMethod: "POST",
      } as any, `user_${rep.id}`);
    }
  } else {
    appendVoiceMessage(response, options, !options.open);
  }
  return response.toString();
}