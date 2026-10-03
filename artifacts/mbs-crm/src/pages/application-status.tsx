import { useState } from "react";
import { CheckCircle2, Circle, Clock, Phone, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandLogo } from "@/components/brand-logo";
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
                  isCompleted && "border-success/30 bg-chart-1 text-white",
                  isCurrent && !isDeclined && "border-info bg-solid text-white",
                  isCurrent && isDeclined && stage.key === "declined" && "border-danger/30 bg-chart-4 text-white",
                  isFuture && "border-border bg-card text-muted-foreground",
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
                <div className={cn("w-0.5 flex-1 my-1", isCompleted ? "bg-green-400" : "bg-secondary")} style={{ minHeight: "2rem" }} />
              )}
            </div>

            {/* Label */}
            <div className="pb-6 pt-1 min-w-0">
              <p
                className={cn(
                  "font-semibold text-sm",
                  isCompleted && "text-success",
                  isCurrent && !isDeclined && "text-info",
                  isCurrent && isDeclined && stage.key === "declined" && "text-danger",
                  isFuture && "text-muted-foreground",
                )}
              >
                {stage.label}
                {isCurrent && !isDeclined && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-solid/10 px-2 py-0.5 text-xs font-medium text-info">
                    Current
                  </span>
                )}
              </p>
              <p className={cn("text-xs mt-0.5", isFuture ? "text-muted-foreground" : "text-muted-foreground")}>
                {stage.description}
                {date && (
                  <span className="ml-1 text-muted-foreground">— {formatDate(date)}</span>
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
    <div className="min-h-screen bg-muted">
      {/* Navy header */}
      <header className="bg-solid text-white py-5 px-6 ">
        <div className="mx-auto max-w-2xl flex items-center gap-3">
          <BrandLogo variant="reverse" imageClassName="h-7 w-auto" />
          <div>
            <h1 className="text-lg font-bold leading-tight">My Business Solutions</h1>
            <p className="text-xs text-info">Application Status Tracker</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 space-y-8">
        {/* Search card */}
        <div className="rounded-2xl bg-card border border-border p-6">
          <h2 className="text-xl font-bold text-foreground mb-1">Track Your Application</h2>
          <p className="text-sm text-muted-foreground mb-5">
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
              className="bg-solid hover:bg-sidebar-accent text-white px-6 shrink-0"
            >
              {loading ? "Looking up…" : "Check Status"}
            </Button>
          </form>
          {error && (
            <p className="mt-3 text-sm text-danger bg-danger-bg border border-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Result card */}
        {result && (
          <div className="rounded-2xl bg-card border border-border overflow-hidden">
            {/* Result header */}
            <div className="bg-muted border-b border-border px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Company</p>
                  <h3 className="text-lg font-bold text-foreground">
                    {result.companyName ?? "Your Business"}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {result.applicationType === "equipment" ? "Equipment Financing" : "Working Capital"} · Submitted {formatDate(result.submittedAt)}
                  </p>
                </div>
                {result.repName && (
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Your Rep</p>
                    <p className="text-sm font-semibold text-foreground">{result.repName}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="px-6 py-6">
              <h4 className="text-sm font-semibold text-foreground mb-5 uppercase tracking-wider">Application Progress</h4>
              <StatusTimeline result={result} />
            </div>
          </div>
        )}

        {/* Contact section */}
        <div className="rounded-2xl border border-border bg-card px-6 py-5">
          <h3 className="font-semibold text-foreground mb-1">Questions? We're here to help.</h3>
          <p className="text-sm text-muted-foreground mb-4">Contact your rep directly or reach out to our funding team.</p>
          <div className="flex flex-wrap gap-4">
            <a
              href="tel:+19088608507"
              className="flex items-center gap-2 text-sm text-info hover:underline font-medium"
            >
              <Phone className="h-4 w-4" />
              (908) 860-8507
            </a>
            <a
              href="mailto:funding@my-business-solutions.com"
              className="flex items-center gap-2 text-sm text-info hover:underline font-medium"
            >
              <Mail className="h-4 w-4" />
              funding@my-business-solutions.com
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} My Business Solutions · Your information is kept secure and confidential.
        </p>
      </main>
    </div>
  );
}
