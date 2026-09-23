import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, CheckCircle2, Database, Pencil, RefreshCw, Send, Star, XCircle } from "lucide-react";
import { getGetLeadSubmissionsQueryKey, getGetLenderMatchesQueryKey, useCreateLeadSubmission, useGetLenderMatches, useGetLeadSubmissions, useGetMe, useRunLenderMatch, useUpdateSubmission, getGetDealQueryKey, getListDealActivityQueryKey } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
import { LenderPackageBuilderDialog } from "./lender-package-builder";
import { filterDeclinedMatches } from "@/lib/lenderSubmissions";
import { useCreateUnderwritingCorrection, useUnderwritingProfile, underwritingProfileKey, type UnderwritingFact } from "@/lib/underwriting-api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiErrorDetails(error: any, fallback: string) {
  const data = error?.data;
  return {
    status: error?.status ?? error?.response?.status,
    reason: data?.reason,
    message: data?.error ?? data?.message ?? error?.message ?? fallback,
  };
}

export function LeadLenderMatch() {
  const { id: leadId, isAdmin, lead } = useLeadDetail();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const runMatch = useRunLenderMatch();
  const { data: matches, isLoading: matchesLoading } = useGetLenderMatches(leadId);
  const { data: submissions } = useGetLeadSubmissions(leadId);
  const createSub = useCreateLeadSubmission();
  const updateSub = useUpdateSubmission();
  const profileQuery = useUnderwritingProfile(leadId);
  const createCorrection = useCreateUnderwritingCorrection();

  // Confirmation modal state
  const [pendingLender, setPendingLender] = useState<{ id: number; name: string } | null>(null);
  const [submissionError, setSubmissionError] = useState<{ msg: string; isConflict: boolean } | null>(null);
  // Expandable criteria state — track which match cards are expanded
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [packageBuilderOpen, setPackageBuilderOpen] = useState(false);
  const [correctionFact, setCorrectionFact] = useState<UnderwritingFact | null>(null);
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");

  const toggleExpanded = (matchId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(matchId) ? next.delete(matchId) : next.add(matchId);
      return next;
    });
  };

  const handleRunMatch = () => {
    runMatch.mutate({ id: leadId }, {
      onSuccess: (data: any) => {
        toast({ title: `Matched ${data.matchCount ?? 0} lenders` });
        queryClient.invalidateQueries({ queryKey: getGetLenderMatchesQueryKey(leadId) });
      },
      onError: (err: any) => {
        toast({ title: "Match failed", description: apiErrorDetails(err, "Match failed").message, variant: "destructive" });
      },
    });
  };

  const confirmSubmit = (override = false) => {
    if (!pendingLender) return;
    setSubmissionError(null);
    createSub.mutate({ id: leadId, data: { lender_id: pendingLender.id, admin_override: override } as any }, {
      onSuccess: (data: any) => {
        toast({ title: `Submitted to ${pendingLender.name}` });
        queryClient.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
        if (data?.dealId) {
          queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(data.dealId) });
          queryClient.invalidateQueries({ queryKey: getListDealActivityQueryKey(data.dealId) });
        }
        setPendingLender(null);
      },
      onError: (err: any) => {
        const details = apiErrorDetails(err, "Submission failed");
        setSubmissionError({
          msg: details.message,
          isConflict: details.status === 409 && details.reason === "duplicate_24h",
        });
      },
    });
  };

  const handleStatusUpdate = (subId: number, status: string) => {
    updateSub.mutate({ id: subId, data: { status } as any }, {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
        if (data?.dealId) {
          queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(data.dealId) });
          queryClient.invalidateQueries({ queryKey: getListDealActivityQueryKey(data.dealId) });
        }
      },
      onError: (err: any) => {
        toast({ title: "Update failed", description: apiErrorDetails(err, "Status update failed").message, variant: "destructive" });
      }
    });
  };

  const [showDeclined, setShowDeclined] = useState(false);
  const canSubmit = isAdmin || (me?.role === "rep" && me.id === lead?.assignedRepId);
  const activeMatches = filterDeclinedMatches(
    (matches ?? []).filter((match: any) => match.lender?.isActive !== false),
    submissions ?? [],
    showDeclined,
  ).sort((a: any, b: any) => {
    const verdictRank = (value: string) => value === "Likely" ? 0 : value === "Possible" ? 1 : 2;
    const verdict = verdictRank(a.verdict) - verdictRank(b.verdict);
    if (verdict) return verdict;
    const approval = Number(b.rankingDimensions?.approvalProbability ?? -1) - Number(a.rankingDimensions?.approvalProbability ?? -1);
    if (approval) return approval;
    const points = Number(b.points ?? -1) - Number(a.points ?? -1);
    if (points) return points;
    return Number(a.turnaround?.max ?? 999) - Number(b.turnaround?.max ?? 999);
  });

  const saveCorrection = () => {
    if (!correctionFact || !correctionReason.trim()) return;
    const numericFields = new Set(["requestedAmount", "creditScore", "timeInBusinessMonths", "monthlyRevenue", "existingPositions", "transactionAmount"]);
    const value = numericFields.has(correctionFact.key) && correctionValue.trim() !== "" ? Number(correctionValue) : correctionValue || null;
    createCorrection.mutate({ leadId, data: { field: correctionFact.key, value, reason: correctionReason.trim() } }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: underwritingProfileKey(leadId) });
        setCorrectionFact(null);
        setCorrectionValue("");
        setCorrectionReason("");
        toast({ title: "Underwriting fact corrected", description: "Run matching again to apply the reviewed fact." });
      },
      onError: (error: any) => toast({ title: "Could not save correction", description: apiErrorDetails(error, "Correction failed").message, variant: "destructive" }),
    });
  };

  const statusColor: Record<string, string> = {
    submitted: "bg-blue-50 text-blue-700 border-blue-200",
    approved: "bg-green-50 text-green-700 border-green-200",
    declined: "bg-red-50 text-red-700 border-red-200",
    funded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  return (
    <div className="space-y-5 mt-4">
      <LenderPackageBuilderDialog leadId={leadId} open={packageBuilderOpen} onOpenChange={setPackageBuilderOpen} submitMode />
      <Dialog open={!!correctionFact} onOpenChange={(open) => !open && setCorrectionFact(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Correct {correctionFact?.label}</DialogTitle>
            <DialogDescription>The source record remains unchanged. This correction is audited and takes precedence in underwriting review.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Reviewed value</Label><Input value={correctionValue} onChange={(event) => setCorrectionValue(event.target.value)} className="mt-1" /></div>
            <div><Label>Reason</Label><Input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="What evidence supports this correction?" className="mt-1" /></div>
            <Button onClick={saveCorrection} disabled={!correctionReason.trim() || createCorrection.isPending} className="w-full">{createCorrection.isPending ? "Saving…" : "Save reviewed correction"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Confirm submission dialog */}
      <Dialog open={!!pendingLender} onOpenChange={(open) => {
        if (!open) { setPendingLender(null); setSubmissionError(null); }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Submission</DialogTitle>
            <DialogDescription>
              You are about to submit this deal to <strong>{pendingLender?.name}</strong>. This will notify the lender and create a submission record. Are you sure?
            </DialogDescription>
          </DialogHeader>

          {submissionError && (
            <div className="bg-red-50 text-red-700 border border-red-100 rounded-md p-3 text-sm flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span className="break-words">{submissionError.msg}</span>
              </div>
              {submissionError.isConflict && isAdmin && (
                <div className="ml-6 flex items-center justify-between border-t border-red-200/50 pt-2 mt-1">
                  <span className="text-xs opacity-90">Override 24h limit?</span>
                  <Button variant="outline" size="sm" className="h-7 text-xs border-red-200 hover:bg-red-100 hover:text-red-800" onClick={() => confirmSubmit(true)}>
                    Admin Override
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => { setPendingLender(null); setSubmissionError(null); }}>Cancel</Button>
            <Button
              size="sm"
              disabled={createSub.isPending}
              onClick={() => confirmSubmit(false)}
            >
              {createSub.isPending ? "Submitting…" : "Yes, Submit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Borrower underwriting profile</h3>
            <p className="text-xs text-muted-foreground">Supported facts, extracted bank metrics, and source provenance. Human review is required.</p>
          </div>
          {profileQuery.data && <Badge variant="outline" className={profileQuery.data.readiness.readyForMatching ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"}>{profileQuery.data.readiness.readyForMatching ? "Ready for matching" : `${profileQuery.data.readiness.missingFields.length} missing facts`}</Badge>}
        </div>
        {profileQuery.isLoading ? <Skeleton className="h-32 m-3" /> : profileQuery.data ? (
          <div className="p-3 space-y-3">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {profileQuery.data.facts.filter((fact) => fact.value != null).map((fact) => (
                <div key={fact.key} className="rounded-lg bg-slate-50 border p-2 group">
                  <div className="flex justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">{fact.label}</span>
                    <button onClick={() => { setCorrectionFact(fact); setCorrectionValue(String(fact.value ?? "")); }} className="text-slate-400 hover:text-blue-700" title="Correct reviewed fact"><Pencil className="h-3 w-3" /></button>
                  </div>
                  <div className="text-sm font-medium text-slate-800 truncate">{typeof fact.value === "number" && /amount|revenue/i.test(fact.key) ? `$${fact.value.toLocaleString()}` : String(fact.value)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><Database className="h-2.5 w-2.5" />{fact.provenance.label}{fact.estimated ? " · estimate" : ""}</div>
                </div>
              ))}
            </div>
            {profileQuery.data.bank && (
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 rounded-lg border bg-blue-50/40 p-2 text-center">
                {[
                  ["Avg deposits", profileQuery.data.bank.averageMonthlyDeposits == null ? "—" : `$${Math.round(profileQuery.data.bank.averageMonthlyDeposits).toLocaleString()}`],
                  ["Avg balance", profileQuery.data.bank.averageDailyBalance == null ? "—" : `$${Math.round(profileQuery.data.bank.averageDailyBalance).toLocaleString()}`],
                  ["NSFs", profileQuery.data.bank.nsfCount],
                  ["Negative days", profileQuery.data.bank.negativeBalanceDays],
                  ["Returned", profileQuery.data.bank.returnedItems],
                  ["Positions", profileQuery.data.bank.positions.length],
                ].map(([label, value]) => <div key={String(label)}><div className="text-xs font-semibold">{value}</div><div className="text-[9px] uppercase text-slate-500">{label}</div></div>)}
              </div>
            )}
            {!profileQuery.data.readiness.readyForMatching && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">Missing for a complete review: {profileQuery.data.readiness.missingFields.join(", ")}. Recommendations may be incomplete.</div>}
          </div>
        ) : <div className="p-3 text-sm text-red-600">Could not load underwriting profile.</div>}
      </div>

      {/* Run Match Button */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Lender Matching</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Run the engine to find the best lenders for this deal</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">Ranked: approval → points → speed</Badge>
          <Button
          size="sm"
          onClick={handleRunMatch}
          disabled={runMatch.isPending}
          >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${runMatch.isPending ? "animate-spin" : ""}`} />
          {runMatch.isPending ? "Matching…" : "Run Match"}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Declined lenders are hidden from recommendations by default.</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowDeclined((value) => !value)}>
          {showDeclined ? "Hide declined" : "Show declined"}
        </Button>
      </div>

      {/* Match Results */}
      {matchesLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : activeMatches.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-xl text-muted-foreground text-sm">
          No matches yet. Click "Run Match" to find lenders.
        </div>
      ) : (
        <div className="space-y-2">
          {activeMatches.map((m: any, idx: number) => {
            const isSubmitted = (submissions ?? []).some((s: any) => s.lenderId === m.lenderId);
            const passedCount = (m.criteriaBreakdown ?? []).filter((c: any) => c.passed && !c.skipped).length;
            const totalCount = (m.criteriaBreakdown ?? []).filter((c: any) => !c.skipped).length;
            const isExpanded = expandedIds.has(m.id);
            const lenderName = m.lender?.name ?? `Lender #${m.lenderId}`;
             return (
               <div key={m.id}>
               {m.matchGroup === "super_broker" && (idx === 0 || (activeMatches[idx - 1] as any)?.matchGroup !== "super_broker") && <div className="pt-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Super-broker options</div>}
                 <div className={`rounded-xl border p-3 space-y-2 ${m.verdict === "Excluded" ? "border-red-200 bg-red-50/30" : idx === 0 ? "border-[#1F4E79]/30 bg-blue-50/30" : "bg-white"}`}>
                <div className="flex items-start justify-between">
                  <button
                    className="flex items-center gap-2 text-left flex-1 min-w-0"
                    onClick={() => toggleExpanded(m.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${idx === 0 ? "bg-[#1F4E79] text-white" : "bg-slate-100 text-slate-600"}`}>
                      {idx + 1}
                    </div>
                    <div className="min-w-0">
                       <div className="flex items-center gap-2">
                         <div className="font-medium text-sm text-slate-800 truncate">{lenderName}</div>
                         <Badge variant="outline" className={`text-[10px] ${m.verdict === "Likely" ? "bg-green-50 text-green-700 border-green-200" : m.verdict === "Excluded" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{m.verdict ?? "Possible"}</Badge>
                       </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-2.5 w-2.5 ${i < Math.round((m.lender?.priorityWeight ?? 5) / 2) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                        ))}
                        <span className="text-[10px] text-muted-foreground ml-1">{m.matchScore}% match · {passedCount}/{totalCount} criteria</span>
                      </div>
                    </div>
                  </button>
                   {canSubmit && m.verdict !== "Excluded" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0 ml-2"
                      onClick={() => setPackageBuilderOpen(true)}
                    >
                       <Send className="h-3 w-3 mr-1" /> {isSubmitted ? "Resubmit" : "Submit"}
                    </Button>
                  ) : isSubmitted ? (
                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 shrink-0 ml-2">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Submitted
                    </Badge>
                  ) : null}
                </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[10px]">
                    <div className="rounded bg-slate-50 border px-2 py-1"><span className="text-slate-500">Reason</span><div className="font-medium text-slate-700">{m.reason ?? "Documented criteria available"}</div></div>
                    <div className="rounded bg-slate-50 border px-2 py-1"><span className="text-slate-500">Tier / down</span><div className="font-medium text-slate-700">{m.expectedTier ?? "—"}{m.downPayment ?? (m.downPaymentPct != null ? `${m.downPaymentPct}%` : "")}{m.downPayment || m.downPaymentPct != null ? " down" : ""}</div></div>
                    <div className="rounded bg-slate-50 border px-2 py-1"><span className="text-slate-500">Points</span><div className="font-medium text-slate-700">{m.points == null ? "—" : `${m.points} pts`}</div></div>
                    <div className="rounded bg-slate-50 border px-2 py-1"><span className="text-slate-500">Turnaround</span><div className="font-medium text-slate-700">{m.turnaround ? `${m.turnaround.min ?? "?"}–${m.turnaround.max ?? "?"} days` : "—"}</div></div>
                  </div>
                  {m.verdict === "Excluded" && m.exclusions?.length > 0 && <div className="rounded bg-red-50 border border-red-100 px-2 py-1 text-[10px] text-red-700"><span className="font-medium">Excluded:</span> {m.exclusions.join(" · ")}</div>}
                  {m.needsBeforeSubmit?.length > 0 && <div className="rounded bg-amber-50 border border-amber-100 px-2 py-1 text-[10px] text-amber-800"><span className="font-medium">Needs before submit:</span> {m.needsBeforeSubmit.join(", ")}</div>}
                 <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 text-center">
                   {[
                     ["Approval", m.rankingDimensions?.approvalProbability],
                     ["Pricing", m.rankingDimensions?.customerPricing],
                     ["Speed", m.rankingDimensions?.fundingSpeed],
                     ["MBS payout", m.rankingDimensions?.mbsPayout],
                     ["Docs", m.rankingDimensions?.documentationBurden],
                     ["Structure", m.rankingDimensions?.overallStructure],
                   ].map(([label, value]) => (
                     <div key={String(label)} className="rounded bg-slate-50 border px-1 py-1">
                       <div className="text-xs font-semibold">{value == null ? "—" : `${value}%`}</div>
                       <div className="text-[9px] text-slate-500">{label}</div>
                     </div>
                   ))}
                 </div>
                 <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-600">
                   {m.economics?.pricing?.minRatePct != null && <span>Est. pricing {m.economics.pricing.minRatePct}%{m.economics.pricing.maxRatePct != null ? `–${m.economics.pricing.maxRatePct}%` : ""}</span>}
                   {m.economics?.turnaroundBusinessDays && <span>Turnaround {m.economics.turnaroundBusinessDays.min ?? "?"}–{m.economics.turnaroundBusinessDays.max ?? "?"} days</span>}
                   {m.economics?.pricing?.termMonths?.length > 0 && <span>Terms {m.economics.pricing.termMonths.join(", ")} months</span>}
                   {m.economics?.pricing?.maxAdvancePct != null && <span>Max advance {m.economics.pricing.maxAdvancePct}%</span>}
                   {m.economics?.pricing?.minDownPaymentPct != null && <span>Down payment {m.economics.pricing.minDownPaymentPct}%+</span>}
                   {m.estimatedGrossRevenue != null && <span>Est. MBS gross ${Number(m.estimatedGrossRevenue).toLocaleString()}</span>}
                 </div>
                 {m.historicalSignal?.submitted > 0 && <div className="text-[10px] text-muted-foreground">Historical signal: {m.historicalSignal.approved} approved, {m.historicalSignal.declined} declined, {m.historicalSignal.funded} funded across {m.historicalSignal.submitted} submissions. Documented rules remain authoritative.</div>}
                 {m.economics?.requiredDocuments?.length > 0 && <div className="text-[10px] text-slate-600"><span className="font-medium">Required documents:</span> {m.economics.requiredDocuments.join(", ")}</div>}

                {/* Criteria breakdown — collapsed summary / expanded detail */}
                {m.criteriaBreakdown?.length > 0 && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {m.criteriaBreakdown.map((c: any, ci: number) => (
                        <span
                          key={ci}
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] border ${
                            c.skipped ? "bg-slate-50 text-slate-400 border-slate-100" :
                            c.passed ? "bg-green-50 text-green-700 border-green-100" : "bg-red-50 text-red-600 border-red-100"
                          }`}
                        >
                          {c.skipped ? null : c.passed ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                          {c.criterion}
                        </span>
                      ))}
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="mt-1 rounded-lg bg-slate-50 border border-slate-100 divide-y divide-slate-100">
                        {m.criteriaBreakdown.map((c: any, ci: number) => (
                          <div key={ci} className={`flex items-start gap-2 px-3 py-2 text-xs ${c.skipped ? "opacity-50" : ""}`}>
                            <span className={`mt-0.5 shrink-0 ${c.skipped ? "text-slate-400" : c.passed ? "text-green-600" : "text-red-500"}`}>
                              {c.skipped ? "–" : c.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            </span>
                            <div>
                              <span className="font-medium text-slate-700">{c.criterion}</span>
                              {c.detail && <p className="text-muted-foreground mt-0.5">{c.detail}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      className="text-[10px] text-[#1F4E79] hover:underline"
                      onClick={() => toggleExpanded(m.id)}
                    >
                      {isExpanded ? "Hide details ↑" : "Show criterion details ↓"}
                    </button>
                  </>
                )}
               </div>
               </div>
            );
          })}
        </div>
      )}

      {/* Submissions */}
      {submissions && submissions.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Submissions</h4>
          {submissions.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm bg-white">
              <div className="min-w-0">
                <span className="font-medium">{s.lender?.name ?? `Lender #${s.lenderId}`}</span>
                <p className="text-xs text-muted-foreground">{format(new Date(s.sentAt), "MMM d, h:mm a")}</p>
                {s.notes && (
                  <p className="text-xs text-slate-600 mt-0.5 italic truncate" title={s.notes}>
                    {s.notes}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor[s.status] ?? "bg-slate-50 text-slate-500"}`}>
                  {s.status}
                </span>
                {s.status === "submitted" && (
                  <select
                    className="text-xs border rounded px-1.5 py-0.5 bg-white"
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) handleStatusUpdate(s.id, e.target.value); }}
                  >
                    <option value="">Update…</option>
                    <option value="approved">Approved</option>
                    <option value="declined">Declined</option>
                    <option value="funded">Funded</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
