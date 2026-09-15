import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetMe } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
const formatStatus = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
export function LeadConsent() {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [forceScrubbing, setForceScrubbing] = useState(false);
  const { id: leadId } = useLeadDetail();

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/leads/${leadId}/compliance-status`, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const handleRtbf = async (force = false) => {
    const msg = force
      ? `This lead has FCRA compliance records. The compliance log will be PRESERVED but all PII fields will be scrubbed. Continue?`
      : `This will permanently scrub all PII from lead #${leadId} (name, email, phone, SSN, DOB, address). The lead record shell is preserved for compliance. Are you sure?`;
    if (!window.confirm(msg)) return;

    const url = force ? `${apiBase}/leads/${leadId}/pii/force` : `${apiBase}/leads/${leadId}/pii`;
    force ? setForceScrubbing(true) : setScrubbing(true);
    try {
      const res = await fetch(url, { method: "DELETE", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "PII scrubbed", description: data.message });
        fetchStatus();
      } else if (res.status === 409 && data.error === "compliance_hold") {
        toast({
          title: "Compliance hold detected",
          description: `${data.complianceLogEntries} compliance log entries exist. Use "Force Scrub" to proceed (preserves compliance log).`,
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: data.error ?? data.message ?? "Unknown error", variant: "destructive" });
      }
    } finally {
      setScrubbing(false);
      setForceScrubbing(false);
    }
  };

  const ConsentIndicator = ({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) => (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      {ok
        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
        : <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
      }
      <div>
        <div className={`text-sm font-medium ${ok ? "text-gray-900" : "text-red-700"}`}>{label}</div>
        {detail && <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>}
      </div>
    </div>
  );

  if (!me || (me.role !== "admin" && me.role !== "manager")) {
    return (
      <div className="py-10 text-center text-muted-foreground text-sm">
        <ShieldCheck className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
        Manager or admin access required to view consent status.
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      {!status && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={fetchStatus} className="gap-1.5">
            <RefreshCw className="h-4 w-4" /> Load Consent Status
          </Button>
        </div>
      )}

      {loading && (
        <div className="space-y-2 px-1">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      )}

      {status && (
        <div className="space-y-4">
          {/* Consent Quick Status */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#1F4E79]" /> Consent & Communication Status
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={fetchStatus} className="h-7 gap-1 text-xs">
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-0">
              <ConsentIndicator
                ok={status.creditConsent.captured && !status.creditConsent.expired}
                label={status.creditConsent.captured ? (status.creditConsent.expired ? "Credit consent EXPIRED (> 30 days)" : "Credit pull consent captured") : "Credit pull consent not captured"}
                detail={status.creditConsent.capturedAt ? `Captured ${format(new Date(status.creditConsent.capturedAt), "MMM d, yyyy HH:mm")} · IP: ${status.creditConsent.consentIp ?? "unknown"} · Age: ${status.creditConsent.ageInDays}d` : "No consent on record"}
              />
              <ConsentIndicator
                ok={status.tcpaConsent.captured}
                label={status.tcpaConsent.captured ? "Not unsubscribed (TCPA OK)" : "Lead has opted out (TCPA)"}
                detail={status.tcpaConsent.note}
              />
              <ConsentIndicator
                ok={status.applicationConsent.consentCreditPull}
                label={status.applicationConsent.consentCreditPull ? "Application credit-pull consent on file" : "No application credit-pull consent"}
                detail={status.applicationConsent.submittedAt ? `Application submitted ${format(new Date(status.applicationConsent.submittedAt), "MMM d, yyyy")}` : "No application on file"}
              />
              <ConsentIndicator
                ok={status.applicationConsent.consentTerms}
                label={status.applicationConsent.consentTerms
                  ? "Application authorization disclosure consent on file"
                  : "Application authorization disclosure consent not on file"}
              />
            </CardContent>
          </Card>

          {/* Communication Permission Summary */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-semibold">Communication Permissions</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-3 gap-4">
              <div className={`rounded-lg border p-3 text-center ${status.canAutoEmail ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canAutoEmail ? "text-emerald-700" : "text-red-700"}`}>Automated Email</div>
                <div className={`text-lg font-bold ${status.canAutoEmail ? "text-emerald-800" : "text-red-800"}`}>{status.canAutoEmail ? "✓ OK" : "✗ Blocked"}</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${status.canAutoSms ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canAutoSms ? "text-emerald-700" : "text-red-700"}`}>Automated SMS</div>
                <div className={`text-lg font-bold ${status.canAutoSms ? "text-emerald-800" : "text-red-800"}`}>{status.canAutoSms ? "✓ OK" : "✗ Blocked"}</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${status.canPullCredit ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canPullCredit ? "text-emerald-700" : "text-red-700"}`}>Credit Pull</div>
                <div className={`text-lg font-bold ${status.canPullCredit ? "text-emerald-800" : "text-red-800"}`}>{status.canPullCredit ? "✓ OK" : "✗ Blocked"}</div>
              </div>
            </CardContent>
          </Card>

          {/* RTBF — admin only */}
          {me.role === "admin" && (
            <Card className="shadow-sm border-red-200">
              <CardHeader className="pb-3 border-b border-red-100">
                <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> Right to be Forgotten (RTBF)
                </CardTitle>
                <CardDescription className="text-xs">
                  Scrubs all PII from this lead on request. Compliance log rows are preserved per FCRA.
                  {status.complianceHolds.hasCreditPulls || status.complianceHolds.complianceLogEntries > 0
                    ? ` This lead has ${status.complianceHolds.complianceLogEntries} compliance log entries and ${status.complianceHolds.hasCreditPulls ? "credit pulls" : "no credit pulls"} — the record will be preserved but PII will be scrubbed.`
                    : " No compliance holds — PII can be fully scrubbed."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRtbf(false)}
                  disabled={scrubbing || forceScrubbing}
                  className="gap-1.5"
                >
                  {scrubbing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scrubbing…</> : "Scrub PII"}
                </Button>
                {(status.complianceHolds.hasCreditPulls || status.complianceHolds.complianceLogEntries > 0) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRtbf(true)}
                    disabled={scrubbing || forceScrubbing}
                    className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                  >
                    {forceScrubbing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scrubbing…</> : "Force Scrub (acknowledge FCRA hold)"}
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}


