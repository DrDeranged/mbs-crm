import { useState } from "react";
import { CheckCircle2, Circle, Clock, Building2, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// All pipeline stages in order — must include every status from LEAD_STATUSES
const PIPELINE_STAGES = [
  { key: "new_lead", label: "Application Received", description: "Your application was received by MBS" },
  { key: "contacted", label: "In Contact", description: "Our team has reached out to you" },
  { key: "application_received", label: "Documents Under Review", description: "All documents received and being reviewed" },
  { key: "follow_up", label: "Follow-up Required", description: "Additional information may be needed" },
  { key: "submitted_to_underwriting", label: "Underwriting", description: "Submitted to the underwriting team" },
  { key: "approved", label: "Approved", description: "Your application has been approved" },
  { key: "funded", label: "Funded", description: "Funds have been disbursed to your account" },
] as const;

const DECLINED_STAGE = { key: "declined", label: "Declined", description: "Application was not approved at this time" } as const;

type StatusEntry = {
  toStatus: string;
  createdAt: string;
};

type StatusResult = {
  status: string;
  applicationType: string;
  companyName: string | null;
  repName: string | null;
  submittedAt: string;
  statusHistory: StatusEntry[];
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function StatusTimeline({ result }: { result: StatusResult }) {
  const isDeclined = result.status === "declined";
  const stages = isDeclined
    ? [PIPELINE_STAGES[0], PIPELINE_STAGES[1], DECLINED_STAGE]
    : [...PIPELINE_STAGES];

  const historyMap = new Map<string, string>();
  for (const h of result.statusHistory) {
    historyMap.set(h.toStatus, h.createdAt);
  }
  // "application_received" date falls back to submittedAt
  if (!historyMap.has("application_received") && result.submittedAt) {
    historyMap.set("application_received", result.submittedAt);
  }

  const currentIdx = stages.findIndex((s) => s.key === result.status);
  // If status is unknown (not in stages list), treat as "in progress" at stage 0
  // rather than implying the final stage (Funded/Declined)
  const effectiveCurrentIdx = currentIdx === -1 ? 0 : currentIdx;

  return (
    <div className="space-y-0">
      {stages.map((stage, idx) => {
        const isCompleted = idx < effectiveCurrentIdx;
        const isCurrent = idx === effectiveCurrentIdx;
        const isFuture = idx > effectiveCurrentIdx;
        const date = historyMap.get(stage.key);
        const isLast = idx === stages.length - 1;

        return (
          <div key={stage.key} className="flex gap-4">
            {/* Icon + connector line */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted && "border-green-500 bg-green-500 text-white",
                  isCurrent && !isDeclined && "border-[#1F4E79] bg-[#1F4E79] text-white",
                  isCurrent && isDeclined && stage.key === "declined" && "border-red-500 bg-red-500 text-white",
                  isFuture && "border-slate-300 bg-white text-slate-300",
                )}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : isCurrent ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Circle className="h-4 w-4" />
                )}
              </div>
              {!isLast && (
                <div className={cn("w-0.5 flex-1 my-1", isCompleted ? "bg-green-400" : "bg-slate-200")} style={{ minHeight: "2rem" }} />
              )}
            </div>

            {/* Label */}
            <div className="pb-6 pt-1 min-w-0">
              <p
                className={cn(
                  "font-semibold text-sm",
                  isCompleted && "text-green-700",
                  isCurrent && !isDeclined && "text-[#1F4E79]",
                  isCurrent && isDeclined && stage.key === "declined" && "text-red-600",
                  isFuture && "text-slate-400",
                )}
              >
                {stage.label}
                {isCurrent && !isDeclined && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-[#1F4E79]/10 px-2 py-0.5 text-xs font-medium text-[#1F4E79]">
                    Current
                  </span>
                )}
              </p>
              <p className={cn("text-xs mt-0.5", isFuture ? "text-slate-400" : "text-slate-500")}>
                {stage.description}
                {date && (
                  <span className="ml-1 text-slate-400">— {formatDate(date)}</span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ApplicationStatus() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`/api/applications/status/${encodeURIComponent(trimmed)}`);
      if (res.status === 404) {
        setError("No application found for that tracking number. Please check the number and try again.");
      } else if (!res.ok) {
        setError("Something went wrong. Please try again later.");
      } else {
        const data: StatusResult = await res.json();
        setResult(data);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navy header */}
      <header className="bg-[#1F4E79] text-white py-5 px-6 shadow-md">
        <div className="mx-auto max-w-2xl flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">My Business Solutions</h1>
            <p className="text-xs text-blue-200">Application Status Tracker</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 space-y-8">
        {/* Search card */}
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-1">Track Your Application</h2>
          <p className="text-sm text-slate-500 mb-5">
            Enter the tracking number from your confirmation email to check your application status.
          </p>
          <form onSubmit={handleLookup} className="flex gap-3">
            <Input
              placeholder="e.g. a3f8c1d29b4e"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-sm flex-1"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={!token.trim() || loading}
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white px-6 shrink-0"
            >
              {loading ? "Looking up…" : "Check Status"}
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Result card */}
        {result && (
          <div className="rounded-2xl bg-white shadow-sm border border-slate-200 overflow-hidden">
            {/* Result header */}
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1">Company</p>
                  <h3 className="text-lg font-bold text-slate-900">
                    {result.companyName ?? "Your Business"}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {result.applicationType === "equipment" ? "Equipment Financing" : "Working Capital"} · Submitted {formatDate(result.submittedAt)}
                  </p>
                </div>
                {result.repName && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-1">Your Rep</p>
                    <p className="text-sm font-semibold text-slate-800">{result.repName}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="px-6 py-6">
              <h4 className="text-sm font-semibold text-slate-700 mb-5 uppercase tracking-wider">Application Progress</h4>
              <StatusTimeline result={result} />
            </div>
          </div>
        )}

        {/* Contact section */}
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5">
          <h3 className="font-semibold text-slate-800 mb-1">Questions? We're here to help.</h3>
          <p className="text-sm text-slate-500 mb-4">Contact your rep directly or reach out to our support team.</p>
          <div className="flex flex-wrap gap-4">
            <a
              href="tel:+18005550000"
              className="flex items-center gap-2 text-sm text-[#1F4E79] hover:underline font-medium"
            >
              <Phone className="h-4 w-4" />
              (800) 555-0000
            </a>
            <a
              href="mailto:support@mybusinesssolutions.com"
              className="flex items-center gap-2 text-sm text-[#1F4E79] hover:underline font-medium"
            >
              <Mail className="h-4 w-4" />
              support@mybusinesssolutions.com
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400">
          © {new Date().getFullYear()} My Business Solutions · Your information is kept secure and confidential.
        </p>
      </main>
    </div>
  );
}
