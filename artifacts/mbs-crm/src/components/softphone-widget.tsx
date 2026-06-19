import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import { useGetTwilioToken } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Mic,
  MicOff,
  Minimize2,
  Delete,
  PhoneCall,
} from "lucide-react";
import { SoftphoneContext } from "./softphone-context";

type WidgetState = "idle" | "calling" | "active" | "incoming";

export function SoftphoneWidget() {
  const { pendingNumber, autoCall, clearPending } = useContext(SoftphoneContext);

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
      if (autoCall) {
        autoCallPending.current = true;
      }
      clearPending();
    }
  }, [pendingNumber, autoCall, clearPending]);

  // Auto-initiate call once device is ready and a pending auto-call is flagged
  useEffect(() => {
    if (autoCallPending.current && deviceRef.current && state === "idle") {
      autoCallPending.current = false;
      // Small delay so dialInput is rendered
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
    setCallSeconds(0);
    timerRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const attachCallHandlers = (call: Call) => {
    call.on("accept", () => {
      setState("active");
      startTimer();
    });
    call.on("disconnect", () => {
      setState("idle");
      stopTimer();
      setActiveCall(null);
      setMuted(false);
    });
    call.on("cancel", () => {
      setState("idle");
      stopTimer();
      setActiveCall(null);
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

  const handleCall = () => handleCallWithNumber(dialInput);

  const handleHangUp = () => {
    activeCall?.disconnect();
    incomingInfo?.callObj.reject();
    setState("idle");
    stopTimer();
    setActiveCall(null);
    setIncomingInfo(null);
    setMuted(false);
  };

  const handleAccept = () => {
    if (!incomingInfo) return;
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
  );
}
