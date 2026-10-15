import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, History, Loader2, MailCheck, MailX, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { EmailOptOutDialog } from "@/components/email-opt-out-dialog";
import { useSetLeadEmailOptOut } from "@/hooks/use-email-opt-out";
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
  const [statusError, setStatusError] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [forceScrubbing, setForceScrubbing] = useState(false);
  const { id: leadId } = useLeadDetail();
  const [optOutAction, setOptOutAction] = useState<boolean | null>(null);
  const [optOutOpen, setOptOutOpen] = useState(false);
  const setOptOut = useSetLeadEmailOptOut(leadId);

  const confirmOptOut = (input: { isUnsubscribed: boolean; reason: string }) => {
    setOptOut.mutate(input, {
      onSuccess: () => {
        setStatus((prev: any) => prev ? { ...prev, isUnsubscribed: input.isUnsubscribed, canAutoEmail: input.isUnsubscribed ? false : prev.canAutoEmail } : prev);
        setOptOutOpen(false);
        toast({ title: input.isUnsubscribed ? "Email opt-out set" : "Email opt-out cleared" });
        void fetchStatus();
      },
      onError: (err: unknown) => toast({ title: "Could not update opt-out", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
    });
  };

  const fetchStatus = async (signal?: AbortSignal) => {
    setLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`${apiBase}/leads/${leadId}/compliance-status`, { credentials: "include", signal });
      if (!res.ok) throw new Error(`Could not load consent status (${res.status})`);
      const data = await res.json();
      if (!signal?.aborted) setStatus(data);
    } catch (error) {
      if (!signal?.aborted) setStatusError(error instanceof Error ? error.message : "Could not load consent status");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    setStatus(null);
    if (me?.role !== "admin" && me?.role !== "manager") return;
    const controller = new AbortController();
    void fetchStatus(controller.signal);
    return () => controller.abort();
  }, [leadId, me?.role]);

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
        ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
        : <XCircle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
      }
      <div>
        <div className={`text-sm font-medium ${ok ? "text-foreground" : "text-danger"}`}>{label}</div>
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
      {statusError && <p role="alert" className="text-sm text-destructive">{statusError}</p>}
      {!status && !loading && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void fetchStatus()} className="gap-1.5">
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
          <Card className="">
            <CardHeader className="pb-3 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-info" /> Consent & Communication Status
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={() => void fetchStatus()} className="h-7 gap-1 text-xs">
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
          <Card className="">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-sm font-semibold">Communication Permissions</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 grid grid-cols-3 gap-4">
              <div className={`rounded-lg border p-3 text-center ${status.canAutoEmail ? "border-success/30 bg-success-bg" : "border-danger/30 bg-danger-bg"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canAutoEmail ? "text-success" : "text-danger"}`}>Automated Email</div>
                <div className={`text-lg font-bold ${status.canAutoEmail ? "text-success" : "text-danger"}`}>{status.canAutoEmail ? "✓ OK" : "✗ Blocked"}</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${status.canAutoSms ? "border-success/30 bg-success-bg" : "border-danger/30 bg-danger-bg"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canAutoSms ? "text-success" : "text-danger"}`}>Automated SMS</div>
                <div className={`text-lg font-bold ${status.canAutoSms ? "text-success" : "text-danger"}`}>{status.canAutoSms ? "✓ OK" : "✗ Blocked"}</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${status.canPullCredit ? "border-success/30 bg-success-bg" : "border-danger/30 bg-danger-bg"}`}>
                <div className={`text-xs font-semibold mb-1 ${status.canPullCredit ? "text-success" : "text-danger"}`}>Credit Pull</div>
                <div className={`text-lg font-bold ${status.canPullCredit ? "text-success" : "text-danger"}`}>{status.canPullCredit ? "✓ OK" : "✗ Blocked"}</div>
              </div>
            </CardContent>
          </Card>

          {/* Email opt-out control */}
          {(() => {
            const unsubscribed: boolean = status.isUnsubscribed === true;
            const history: any[] = Array.isArray(status.emailOptOutHistory) ? status.emailOptOutHistory : [];
            return (
              <Card data-testid="card-email-opt-out">
                <CardHeader className="pb-3 border-b">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      {unsubscribed ? <MailX className="h-4 w-4 text-danger" /> : <MailCheck className="h-4 w-4 text-success" />}
                      Email opt-out
                    </CardTitle>
                    <span data-testid="status-email-opt-out" className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${unsubscribed ? "border-danger/30 bg-danger-bg text-danger" : "border-success/30 bg-success-bg text-success"}`}>
                      {unsubscribed ? "Opted out" : "Subscribed"}
                    </span>
                  </div>
                  <CardDescription className="text-xs">This is the existing shared opt-out flag, the same one set by unsubscribe links. A reason is required and recorded. Other opted-out records with the same address may continue suppression after clearing here.</CardDescription>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" data-testid="button-set-opt-out" disabled={unsubscribed || setOptOut.isPending}
                      className="gap-1.5 border-danger/30 text-danger hover:bg-danger-bg"
                      onClick={() => { setOptOutAction(true); setOptOutOpen(true); }}>
                      <MailX className="h-3.5 w-3.5" /> Set opt-out
                    </Button>
                    <Button size="sm" variant="outline" data-testid="button-clear-opt-out" disabled={!unsubscribed || setOptOut.isPending}
                      className="gap-1.5" onClick={() => { setOptOutAction(false); setOptOutOpen(true); }}>
                      <MailCheck className="h-3.5 w-3.5" /> Clear opt-out
                    </Button>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><History className="h-3.5 w-3.5" /> Recent changes</p>
                    {history.length === 0 ? (
                      <p className="text-xs text-muted-foreground" data-testid="text-opt-out-history-empty">No manual opt-out changes recorded.</p>
                    ) : (
                      <ol className="space-y-2">
                        {history.map((h) => (
                          <li key={h.id} data-testid={`row-opt-out-history-${h.id}`} className="rounded-md border-l-2 border-border bg-muted/40 px-3 py-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                              <span className={`font-semibold ${h.details?.isUnsubscribed ? "text-danger" : "text-success"}`}>{h.details?.isUnsubscribed ? "Opt-out set" : "Opt-out cleared"}</span>
                              <span className="text-muted-foreground">{h.createdAt ? format(new Date(h.createdAt), "MMM d, yyyy h:mm a") : ""}</span>
                            </div>
                            <div className="mt-0.5 text-muted-foreground">by {h.actorName || (h.userId ? `User #${h.userId}` : "System")}</div>
                            {h.details?.reason && <p className="mt-1 whitespace-pre-wrap text-foreground">{h.details.reason}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}
          <EmailOptOutDialog open={optOutOpen} onOpenChange={setOptOutOpen} count={1} initialAction={optOutAction} pending={setOptOut.isPending} onConfirm={confirmOptOut} />

          {/* RTBF — admin only */}
          {me.role === "admin" && (
            <Card className="border-danger/30">
              <CardHeader className="pb-3 border-b border-danger/30">
                <CardTitle className="text-sm font-semibold text-danger flex items-center gap-2">
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
                    className="gap-1.5 border-danger/30 text-danger hover:bg-danger-bg"
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


