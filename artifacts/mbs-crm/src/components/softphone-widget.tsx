import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import {
  useGetTwilioToken,
  useUpdateCommunication,
  useCreateTask,
  getListCommunicationsQueryKey,
  getListTasksQueryKey,
  getListLeadActivityQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Minimize2,
  Delete,
  ClipboardList,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { SoftphoneContext } from "./softphone-context";
import { useQueryClient } from "@tanstack/react-query";

type WidgetState = "idle" | "calling" | "active" | "incoming";
type CallOutcome = "connected" | "voicemail" | "no_answer" | "wrong_number" | "busy";

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  connected: "Connected",
  voicemail: "Voicemail",
  no_answer: "No Answer",
  wrong_number: "Wrong Number",
  busy: "Busy",
};

export function SoftphoneWidget() {
  const { pendingNumber, autoCall, pendingLeadId, clearPending } = useContext(SoftphoneContext);
  const queryClient = useQueryClient();

  const [minimized, setMinimized] = useState(true);
  const [dialInput, setDialInput] = useState("");
  const [state, setState] = useState<WidgetState>("idle");
  const [muted, setMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [incomingInfo, setIncomingInfo] = useState<{ from: string; callObj: Call } | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const autoCallPending = useRef(false);
  // Tracks the lead ID for the current/last call — set from context on dial, cleared on manual/incoming call
  const activeLeadIdRef = useRef<number | undefined>(undefined);
  const callSecondsRef = useRef(0);

  // In-call notes (collapsible)
  const [showInCallNotes, setShowInCallNotes] = useState(false);
  const [inCallNotes, setInCallNotes] = useState("");

  // Post-call modal state
  const [showPostCall, setShowPostCall] = useState(false);
  const [postCallLeadId, setPostCallLeadId] = useState<number | undefined>(undefined);
  const [postCallCommId, setPostCallCommId] = useState<number | undefined>(undefined);
  const [postCallDuration, setPostCallDuration] = useState(0);
  const [callNotes, setCallNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState<CallOutcome | "">("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTitle, setFollowUpTitle] = useState("");
  const updateComm = useUpdateCommunication();
  const createTask = useCreateTask();

  const { mutate: fetchToken } = useGetTwilioToken({
    mutation: {
      onSuccess: (data) => {
        initDevice(data.token);
      },
      onError: () => {
        setError("Twilio not configured. Set TWILIO_* secrets to enable calling.");
      },
    },
  });

  const initDevice = useCallback((token: string) => {
    if (deviceRef.current) {
      deviceRef.current.destroy();
    }
    const dev = new Device(token, { logLevel: 1, codecPreferences: ["opus", "pcmu"] as any });

    dev.on("incoming", (call: Call) => {
      const from = call.parameters["From"] ?? "Unknown";
      setIncomingInfo({ from, callObj: call });
      setState("incoming");
      setMinimized(false);
    });

    dev.on("error", (err: any) => {
      setError(err?.message ?? "Device error");
      setState("idle");
    });

    dev.register();
    deviceRef.current = dev;
    setDevice(dev);
  }, []);

  useEffect(() => {
    fetchToken();
    return () => {
      deviceRef.current?.destroy();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Handle dial requests from context (click-to-call)
  useEffect(() => {
    if (pendingNumber && pendingNumber !== "") {
      setDialInput(pendingNumber);
      setMinimized(false);
      activeLeadIdRef.current = pendingLeadId; // bind lead context to this call
      if (autoCall) {
        autoCallPending.current = true;
      }
      clearPending();
    }
  }, [pendingNumber, autoCall, pendingLeadId, clearPending]);

  // Auto-initiate call once device is ready and a pending auto-call is flagged
  useEffect(() => {
    if (autoCallPending.current && deviceRef.current && state === "idle") {
      autoCallPending.current = false;
      setTimeout(() => {
        setDialInput((current) => {
          if (current) {
            handleCallWithNumber(current);
          }
          return current;
        });
      }, 200);
    }
  }, [state, device]);

  const startTimer = () => {
    callSecondsRef.current = 0;
    setCallSeconds(0);
    timerRef.current = setInterval(() => {
      callSecondsRef.current += 1;
      setCallSeconds(callSecondsRef.current);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const openPostCallModal = (leadId: number | undefined, twilioSid: string | undefined, durationSec: number, notes: string) => {
    setPostCallLeadId(leadId);
    setPostCallDuration(durationSec);
    setCallNotes(notes); // pre-populate with any in-call notes
    setCallOutcome("");
    setFollowUpDate("");
    setFollowUpTitle("");
    setPostCallCommId(undefined);
    setShowInCallNotes(false);
    setInCallNotes("");
    setShowPostCall(true);

    if (leadId) {
      // Fetch comms and match by Twilio SID (deterministic), with retries for webhook latency
      const findComm = async (attempt: number): Promise<void> => {
        try {
          const res = await fetch(`/api/leads/${leadId}/communications`);
          if (res.ok) {
            const comms: any[] = await res.json();
            const bySid = twilioSid ? comms.find((c) => c.type === "call" && c.twilioSid === twilioSid) : null;
            const byLatest = comms.find((c) => c.type === "call");
            const found = bySid ?? byLatest;
            if (found) {
              setPostCallCommId(found.id);
              return;
            }
          }
        } catch {
          // ignore
        }
        if (attempt < 3) {
          setTimeout(() => findComm(attempt + 1), 2000 * attempt);
        }
      };
      setTimeout(() => findComm(1), 1500);
    }
  };

  const attachCallHandlers = (call: Call) => {
    let sid: string | undefined;
    call.on("accept", () => {
      sid = call.parameters["CallSid"] as string | undefined;
      setState("active");
      startTimer();
    });
    call.on("disconnect", () => {
      const duration = callSecondsRef.current;
      const capturedNotes = inCallNotes; // capture before reset
      setState("idle");
      stopTimer();
      setActiveCall(null);
      setMuted(false);
      openPostCallModal(activeLeadIdRef.current, sid, duration, capturedNotes);
    });
    call.on("cancel", () => {
      setState("idle");
      stopTimer();
      setActiveCall(null);
      setShowInCallNotes(false);
      setInCallNotes("");
    });
    call.on("reject", () => {
      setState("idle");
      setActiveCall(null);
    });
    setActiveCall(call);
  };

  const handleCallWithNumber = async (number: string) => {
    if (!deviceRef.current || !number.trim()) return;
    try {
      setState("calling");
      const call = await deviceRef.current.connect({ params: { To: number.trim() } });
      attachCallHandlers(call);
    } catch (e: any) {
      setError(e?.message ?? "Call failed");
      setState("idle");
    }
  };

  // Manual dial: no lead context — reset ref so stale leadId isn't carried over
  const handleCall = () => {
    activeLeadIdRef.current = undefined;
    handleCallWithNumber(dialInput);
  };

  const handleHangUp = () => {
    activeCall?.disconnect();
    incomingInfo?.callObj.reject();
    setState("idle");
    stopTimer();
    setActiveCall(null);
    setIncomingInfo(null);
    setMuted(false);
  };

  // Incoming call: no known lead context
  const handleAccept = () => {
    if (!incomingInfo) return;
    activeLeadIdRef.current = undefined;
    setDialInput(incomingInfo.from);
    attachCallHandlers(incomingInfo.callObj);
    incomingInfo.callObj.accept();
    setState("active");
    startTimer();
    setIncomingInfo(null);
  };

  const handleDecline = () => {
    incomingInfo?.callObj.reject();
    setState("idle");
    setIncomingInfo(null);
  };

  const handleMute = () => {
    if (!activeCall) return;
    const next = !muted;
    activeCall.mute(next);
    setMuted(next);
  };

  const handleSavePostCall = () => {
    const commId = postCallCommId;
    const leadId = postCallLeadId;

    if (!commId) {
      setShowPostCall(false);
      return;
    }

    updateComm.mutate(
      {
        id: commId,
        data: {
          callNotes: callNotes || undefined,
          callOutcome: callOutcome || undefined,
        },
      },
      {
        onSuccess: () => {
          // Create follow-up task client-side via the guarded tasks endpoint
          if (followUpDate && leadId) {
            createTask.mutate(
              { id: leadId, data: { title: followUpTitle || "Follow-up call", dueDate: followUpDate } },
              {
                onSettled: () => {
                  queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) });
                  queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
                },
              }
            );
          }
          setShowPostCall(false);
          if (leadId) {
            queryClient.invalidateQueries({ queryKey: getListCommunicationsQueryKey(leadId) });
          }
        },
        onError: () => {
          setShowPostCall(false);
        },
      }
    );
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const dialPad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"] as const;

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragStart.current = { mx: e.clientX, my: e.clientY, px: position.x, py: position.y };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      setPosition({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const isActive = state === "active";
  const isCalling = state === "calling";
  const isIncoming = state === "incoming";
  const isBusy = isActive || isCalling || isIncoming;

  return (
    <>
      {/* Post-call notes modal */}
      <Dialog open={showPostCall} onOpenChange={setShowPostCall}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-[#1F4E79]" />
              Post-Call Notes
            </DialogTitle>
            <DialogDescription>
              {postCallDuration > 0
                ? `Call duration: ${formatTime(postCallDuration)} — log the outcome and any notes below.`
                : "Log the outcome and any notes for this call."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Call Outcome</Label>
              <Select value={callOutcome} onValueChange={(v) => setCallOutcome(v as CallOutcome)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome…" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(OUTCOME_LABELS) as [CallOutcome, string][]).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Call Notes</Label>
              <Textarea
                placeholder="Spoke with John, interested in $50k MCA…"
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                className="min-h-[80px] resize-none"
                autoFocus
              />
            </div>

            <div className="border-t pt-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Schedule Follow-Up (optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Date</Label>
                  <Input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Task Title</Label>
                  <Input
                    placeholder="Follow-up call"
                    value={followUpTitle}
                    onChange={(e) => setFollowUpTitle(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowPostCall(false)}>
                Skip
              </Button>
              <Button
                className="flex-1 bg-[#1F4E79] hover:bg-[#163a5f] text-white"
                onClick={handleSavePostCall}
                disabled={updateComm.isPending || createTask.isPending}
              >
                {updateComm.isPending || createTask.isPending ? "Saving…" : "Save Notes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Softphone widget */}
      <div
        className="fixed z-50"
        style={{
          bottom: `${24 - position.y}px`,
          right: `${24 - position.x}px`,
          cursor: dragging ? "grabbing" : "auto",
        }}
      >
        {minimized ? (
          <button
            onClick={() => setMinimized(false)}
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[#1F4E79] text-white shadow-lg hover:bg-[#163a5f] transition-colors"
            title="Open softphone"
          >
            <Phone className="h-6 w-6" />
            {isBusy && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[10px] font-bold">
                •
              </span>
            )}
          </button>
        ) : (
          <div className="w-72 rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            {/* Header — drag handle */}
            <div
              className="flex items-center justify-between bg-[#1F4E79] px-4 py-3 cursor-grab select-none"
              onMouseDown={handleDragStart}
            >
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-white" />
                <span className="text-sm font-semibold text-white">Softphone</span>
                {isBusy && (
                  <Badge className="bg-green-500 text-white text-xs px-1.5 py-0 h-5">
                    {isIncoming ? "Incoming" : isCalling ? "Calling…" : formatTime(callSeconds)}
                  </Badge>
                )}
              </div>
              <button
                onClick={() => setMinimized(true)}
                className="text-white/70 hover:text-white transition-colors"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {error && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  {error}
                </div>
              )}

              {/* Incoming call alert */}
              {isIncoming && incomingInfo && (
                <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-blue-800">
                    <PhoneIncoming className="h-4 w-4 animate-pulse" />
                    <span className="text-sm font-medium">Incoming call</span>
                  </div>
                  <p className="text-xs text-blue-700 font-mono">{incomingInfo.from}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAccept} className="flex-1 bg-green-600 hover:bg-green-700 text-white h-8 text-xs">
                      Accept
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleDecline} className="flex-1 h-8 text-xs">
                      Decline
                    </Button>
                  </div>
                </div>
              )}

              {!isIncoming && (
                <>
                  {/* Number input */}
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <input
                      type="tel"
                      value={dialInput}
                      onChange={(e) => setDialInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !isBusy) handleCall(); }}
                      placeholder="+1 (555) 000-0000"
                      className="flex-1 bg-transparent text-sm font-mono text-slate-900 outline-none placeholder:text-slate-400"
                      disabled={isBusy}
                    />
                    {dialInput && !isBusy && (
                      <button
                        onClick={() => setDialInput((v) => v.slice(0, -1))}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <Delete className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Dial pad */}
                  {!isBusy && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {dialPad.map((k) => (
                        <button
                          key={k}
                          onClick={() => setDialInput((v) => v + k)}
                          className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Active call controls */}
                  {isActive && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={handleMute}
                          className={cn(
                            "flex h-10 w-10 items-center justify-center rounded-full border transition-colors",
                            muted
                              ? "bg-red-100 border-red-300 text-red-600"
                              : "bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200"
                          )}
                          title={muted ? "Unmute" : "Mute"}
                        >
                          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </button>
                        <div className="text-center">
                          <div className="text-lg font-mono font-bold text-slate-800">{formatTime(callSeconds)}</div>
                          <div className="text-xs text-slate-500">Connected</div>
                        </div>
                        <div className="w-10" />
                      </div>

                      {/* Collapsible in-call notes */}
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <button
                          onClick={() => setShowInCallNotes((v) => !v)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-medium text-slate-600"
                        >
                          <span className="flex items-center gap-1.5">
                            <ClipboardList className="h-3 w-3" />
                            In-call notes
                            {inCallNotes && <span className="text-[#1F4E79]">•</span>}
                          </span>
                          {showInCallNotes
                            ? <ChevronUp className="h-3 w-3" />
                            : <ChevronDown className="h-3 w-3" />
                          }
                        </button>
                        {showInCallNotes && (
                          <Textarea
                            value={inCallNotes}
                            onChange={(e) => setInCallNotes(e.target.value)}
                            placeholder="Jot notes while on the call…"
                            className="border-0 border-t rounded-none text-xs min-h-[60px] resize-none focus-visible:ring-0"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Call / Hang up button */}
                  <div className="flex justify-center">
                    {isBusy ? (
                      <Button
                        onClick={handleHangUp}
                        size="lg"
                        className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 text-white p-0"
                      >
                        <PhoneOff className="h-5 w-5" />
                      </Button>
                    ) : (
                      <Button
                        onClick={handleCall}
                        size="lg"
                        disabled={!dialInput.trim() || !device}
                        className="h-12 w-12 rounded-full bg-green-600 hover:bg-green-700 text-white p-0 disabled:opacity-50"
                      >
                        <Phone className="h-5 w-5" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
