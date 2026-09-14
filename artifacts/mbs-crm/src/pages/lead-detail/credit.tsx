import { useState } from "react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getUserDisplayName } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaptureCreditConsent, useGetLeadCredit, usePullCreditReport } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
function CreditScoreGauge({ score }: { score: number }) {
  const pct = Math.min(1, Math.max(0, (score - 300) / (850 - 300)));
  const angle = -135 + pct * 270;
  const { color, label } =
    score >= 740 ? { color: "#059669", label: "Excellent" } :
    score >= 670 ? { color: "#16a34a", label: "Good" } :
    score >= 580 ? { color: "#d97706", label: "Fair" } :
                   { color: "#dc2626", label: "Poor" };
  return (
    <div className="flex flex-col items-center gap-2 py-4">
      <svg width="160" height="90" viewBox="0 0 160 90">
        <path d="M 10 85 A 70 70 0 0 1 150 85" fill="none" stroke="#e2e8f0" strokeWidth="12" strokeLinecap="round" />
        <path d="M 10 85 A 70 70 0 0 1 150 85" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${pct * 220} 220`} />
        <g transform={`translate(80, 85) rotate(${angle})`}>
          <line x1="0" y1="0" x2="0" y2="-52" stroke="#1e293b" strokeWidth="3" strokeLinecap="round" />
          <circle cx="0" cy="0" r="5" fill="#1e293b" />
        </g>
      </svg>
      <div className="text-4xl font-bold" style={{ color }}>{score}</div>
      <div className="text-sm font-semibold uppercase tracking-wider" style={{ color }}>{label}</div>
      <div className="text-xs text-muted-foreground">Score range: 300 – 850</div>
    </div>
  );
}

// ─── Lead Credit Tab ──────────────────────────────────────────────────────────
export function LeadCredit() {
  const { id: leadId } = useLeadDetail();
  const { data: pulls, isLoading, refetch } = useGetLeadCredit(leadId);
  const captureCreditConsent = useCaptureCreditConsent();
  const pullCreditReport = usePullCreditReport();
  const { toast } = useToast();

  const [consentChecked, setConsentChecked] = useState(false);
  const [pullType, setPullType] = useState<"soft" | "hard">("soft");
  const [pulling, setPulling] = useState(false);
  const [showConsentFlow, setShowConsentFlow] = useState(false);

  const latestPull = pulls?.[0];
  const lastCompletedPull = pulls?.find((p) => p.status === "completed");
  const hasPulls = !!lastCompletedPull;
  const latestIsError = pulls && pulls.length > 0 && latestPull?.status === "error";
  const displayPull = lastCompletedPull ?? undefined;

  const handlePull = async () => {
    if (!consentChecked) return;
    setPulling(true);
    try {
      await captureCreditConsent.mutateAsync({ id: leadId, data: { consent_type: "credit_pull", agreed: true } });
      await pullCreditReport.mutateAsync({ id: leadId, data: { pull_type: pullType } });
      await refetch();
      setConsentChecked(false);
      setShowConsentFlow(false);
      toast({ title: "Credit report pulled successfully" });
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      const msg = e?.data?.error ?? e?.message ?? "Failed to pull credit report";
      toast({ title: "Credit Pull Failed", description: msg, variant: "destructive" });
    } finally {
      setPulling(false);
    }
  };

  if (isLoading) {
    return <div className="mt-4 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  const summary = displayPull?.reportSummary as {
    tradelineSummary?: Array<{ creditor: string; balance: number | null; status: string; paymentHistory: string }>;
    inquiryCount?: number;
    derogatoryCount?: number;
    publicRecordsCount?: number;
    tradelineCount?: number;
  } | null | undefined;

  const showConsent = !hasPulls || showConsentFlow;

  return (
    <div className="mt-4 space-y-4">
      {/* Consent + Pull flow */}
      {showConsent && (
        <Card className="shadow-sm border-blue-100">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[#1F4E79]" /> Pull Credit Report
            </CardTitle>
            <CardDescription>
              Requires Experian API credentials (EXPERIAN_API_KEY, EXPERIAN_API_SECRET, EXPERIAN_API_URL) and an active application with encrypted SSN.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <Checkbox
                id="credit-consent"
                checked={consentChecked}
                onCheckedChange={(v) => setConsentChecked(Boolean(v))}
              />
              <label htmlFor="credit-consent" className="text-sm cursor-pointer leading-relaxed">
                <span className="font-semibold">I confirm that</span> the applicant has explicitly authorized a credit inquiry for the purpose of evaluating their credit application.
              </label>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pull Type</label>
                <select
                  value={pullType}
                  onChange={(e) => setPullType(e.target.value as "soft" | "hard")}
                  className="border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="soft">Soft Pull (does not affect credit score)</option>
                  <option value="hard">Hard Pull (visible on credit report)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 justify-end">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider invisible">Action</label>
                <Button
                  onClick={handlePull}
                  disabled={!consentChecked || pulling}
                  className="gap-2 min-w-40"
                >
                  {pulling ? <><Loader2 className="h-4 w-4 animate-spin" /> Pulling...</> : <><ShieldCheck className="h-4 w-4" /> Pull Credit Report</>}
                </Button>
              </div>
            </div>
            {hasPulls && (
              <Button variant="ghost" size="sm" onClick={() => setShowConsentFlow(false)} className="text-muted-foreground">
                Cancel
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Latest credit result */}
      {hasPulls && displayPull && !showConsent && (
        <>
          {latestIsError && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <XCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-semibold text-red-700">Latest pull failed</span>
                <span className="text-red-600"> — {latestPull?.errorMessage ?? "Unknown error"}. Showing most recent completed report below.</span>
              </div>
            </div>
          )}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Latest Credit Score</CardTitle>
              <Button variant="outline" size="sm" onClick={() => { setShowConsentFlow(true); setConsentChecked(false); }} className="gap-1.5 text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Pull Again
              </Button>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="flex flex-col md:flex-row items-center gap-6">
                {displayPull.creditScore != null && <CreditScoreGauge score={displayPull.creditScore} />}
                <div className="grid grid-cols-3 gap-4 flex-1">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{summary?.inquiryCount ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Inquiries</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{summary?.derogatoryCount ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Derogatory</div>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <div className="text-2xl font-bold text-foreground">{summary?.publicRecordsCount ?? 0}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Public Records</div>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
                <Badge variant="outline" className={displayPull.pullType === "hard" ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700"}>
                  {displayPull.pullType === "hard" ? "Hard Pull" : "Soft Pull"}
                </Badge>
                <span>pulled by {getUserDisplayName(displayPull.pulledBy as { name?: string | null; email?: string | null } | null, "Unknown")}</span>
                <span>·</span>
                <span>{format(new Date(displayPull.createdAt!), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            </CardContent>
          </Card>

          {/* Tradelines */}
          {summary?.tradelineSummary && summary.tradelineSummary.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Tradelines ({summary.tradelineCount ?? summary.tradelineSummary.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Creditor</th>
                        <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Balance</th>
                        <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment History</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.tradelineSummary.map((tl, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2.5 px-4 font-medium">{tl.creditor || "—"}</td>
                          <td className="py-2.5 px-4">{tl.balance != null ? `$${Number(tl.balance).toLocaleString()}` : "—"}</td>
                          <td className="py-2.5 px-4">
                            <Badge variant="outline" className={/current|ok/i.test(tl.status) ? "border-green-300 text-green-700" : /delinq|late|charge/i.test(tl.status) ? "border-red-300 text-red-700" : ""}>
                              {tl.status || "—"}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-xs tracking-widest">{tl.paymentHistory || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Error state — only when there are no completed pulls to fall back on */}
      {!hasPulls && latestIsError && (
        <Card className="shadow-sm border-red-100">
          <CardContent className="pt-4 flex items-start gap-3">
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-sm text-red-700">Last pull failed</div>
              <div className="text-sm text-muted-foreground mt-0.5">{latestPull?.errorMessage ?? "Unknown error"}</div>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => { setShowConsentFlow(true); setConsentChecked(false); }}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pull History */}
      {pulls && pulls.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Pull History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pulled By</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Score</th>
                  <th className="text-left py-2.5 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {pulls.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-4 text-muted-foreground">{format(new Date(p.createdAt!), "MMM d, yyyy")}</td>
                    <td className="py-2.5 px-4">
                      <Badge variant="outline" className={p.pullType === "hard" ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700"}>
                        {p.pullType === "hard" ? "Hard" : "Soft"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4">{getUserDisplayName(p.pulledBy as { name?: string | null; email?: string | null } | null, "—")}</td>
                    <td className="py-2.5 px-4 font-semibold">{p.creditScore ?? "—"}</td>
                    <td className="py-2.5 px-4">
                      {p.status === "completed" && <Badge className="bg-green-100 text-green-700 border-green-200">Completed</Badge>}
                      {p.status === "error" && <Badge className="bg-red-100 text-red-700 border-red-200">Error</Badge>}
                      {p.status === "pending" && <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">Pending</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
