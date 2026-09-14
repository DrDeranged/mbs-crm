import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PhoneLink } from "@/components/phone-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BarChart3, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { getGetLeadQueryKey, useGenerateLeadBriefing, useGenerateNextBestAction, useRecalculateLeadScore } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
import { LeadDeals } from "./deals";
function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-[#17A567]" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  const labelColor = score >= 70 ? "text-[#149258]" : score >= 40 ? "text-amber-700" : "text-red-700";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold text-[#0E2A47] tabular-nums">{score}<span className="text-sm font-normal text-muted-foreground">/100</span></span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${score >= 70 ? "bg-[#17A567]/10" : score >= 40 ? "bg-amber-100" : "bg-red-100"} ${labelColor}`}>{label}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
export function LeadInfo() {
  const { lead, id: leadId } = useLeadDetail();
  const recalcScore = useRecalculateLeadScore();
  const generateBriefing = useGenerateLeadBriefing();
  const generateNextAction = useGenerateNextBestAction();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleGenerateBriefing = () => {
    generateBriefing.mutate({ id: leadId }, {
      onSuccess: () => {
        toast({ title: "AI briefing generated" });
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
      },
      onError: () => toast({ title: "Error", description: "Failed to generate AI briefing.", variant: "destructive" }),
    });
  };

  const handleRecalcScore = () => {
    recalcScore.mutate({ id: leadId }, {
      onSuccess: () => {
        toast({ title: "Score updated" });
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
      },
      onError: () => toast({ title: "Score calculation failed", variant: "destructive" }),
    });
  };

  const handleGenerateNextAction = () => {
    generateNextAction.mutate({ id: leadId }, {
      onError: () => toast({
        title: "Next action unavailable",
        description: "Could not generate recommendations for this lead.",
        variant: "destructive",
      }),
    });
  };

  const fields = [
    { label: "First Name", value: lead.firstName },
    { label: "Last Name", value: lead.lastName },
    { label: "Email", value: lead.email ? <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">{lead.email}</a> : "—" },
    { label: "Phone", value: lead.phone ? <PhoneLink phone={lead.phone} /> : "—" },
    { label: "Company", value: lead.companyName || "—" },
    { label: "EIN", value: lead.ein || "—" },
    { label: "Financing Type", value: lead.applicationType?.replace(/_/g, " ") || "—" },
    { label: "Lead Source", value: lead.leadSource || "—" },
    { label: "Created", value: format(new Date(lead.createdAt), "MMM d, yyyy") },
    { label: "Last Updated", value: format(new Date(lead.updatedAt), "MMM d, yyyy") },
  ];

  const scoreBreakdown = lead.leadScoreBreakdown as any;

  const briefing = lead.aiSummary as any;

  return (
    <div className="mt-4 space-y-6">
      <Card className="shadow-sm border-[#1F4E79]/20">
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-[#1F4E79]" /> AI Deal Briefing
            </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-[#1F4E79]"
                  disabled={generateBriefing.isPending}
                  onClick={handleGenerateBriefing}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${generateBriefing.isPending ? "animate-spin" : ""}`} />
                  {generateBriefing.isPending ? "Generating…" : briefing ? "Regenerate" : "Generate Briefing"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="generate-next-action"
                  className="h-7 border-[#1F4E79]/20 px-2 text-xs text-[#1F4E79] hover:bg-[#1F4E79]/5"
                  disabled={generateNextAction.isPending}
                  onClick={handleGenerateNextAction}
                >
                  <ListChecks className={`mr-1 h-3.5 w-3.5 ${generateNextAction.isPending ? "animate-pulse" : ""}`} />
                  {generateNextAction.isPending ? "Thinking…" : "Next best action"}
                </Button>
              </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {briefing ? (
            <>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Snapshot</div>
                <p className="text-sm">{briefing.snapshot}</p>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Financial Picture</div>
                <p className="text-sm">{briefing.financialPicture}</p>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Engagement History</div>
                <p className="text-sm">{briefing.engagementHistory}</p>
              </div>
              {briefing.risks?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> Risks</div>
                  <ul className="text-sm list-disc list-inside space-y-0.5">
                    {briefing.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {briefing.nextBestActions?.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1"><ListChecks className="h-3 w-3 text-green-600" /> Next Best Actions</div>
                  <ul className="text-sm list-disc list-inside space-y-0.5">
                    {briefing.nextBestActions.map((a: string, i: number) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {lead.aiSummaryGeneratedAt && (
                <p className="text-[11px] text-muted-foreground">Generated {formatDistanceToNow(new Date(lead.aiSummaryGeneratedAt), { addSuffix: true })}</p>
              )}
            </>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No AI briefing yet</p>
              <p className="text-xs mt-1">Click Generate Briefing for a summary of this deal</p>
            </div>
          )}
          {generateNextAction.data && (
            <div className="border-t border-[#1F4E79]/10 pt-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5 text-[#1F4E79]" /> Next best action
              </div>
              <ol className="space-y-2">
                {generateNextAction.data.actions.map((action, index) => (
                  <li key={`${action}-${index}`} className="flex gap-2 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1F4E79]/10 text-xs font-semibold text-[#1F4E79]">{index + 1}</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted-foreground">Recommendations only · generated {formatDistanceToNow(new Date(generateNextAction.data.generatedAt), { addSuffix: true })}</p>
            </div>
          )}
          {generateNextAction.isPending && (
            <div className="border-t border-[#1F4E79]/10 pt-4 text-sm text-muted-foreground">Analyzing lead details, activity, and lender matches…</div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Lead Score</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-[#1F4E79]"
              disabled={recalcScore.isPending}
              onClick={handleRecalcScore}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${recalcScore.isPending ? "animate-spin" : ""}`} />
              {recalcScore.isPending ? "Scoring…" : "Recalculate"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {lead.leadScore !== null && lead.leadScore !== undefined ? (
            <>
              <ScoreBar score={lead.leadScore} />
              {scoreBreakdown?.criteria && (
                <div className="space-y-2">
                  {scoreBreakdown.criteria.map((c: any) => (
                    <div key={c.name} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-gray-700 truncate">{c.name}</span>
                          <span className="text-xs font-semibold text-gray-900 ml-2 shrink-0">{c.points}<span className="text-muted-foreground font-normal">/{c.maxPoints}</span></span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${c.points >= c.maxPoints * 0.75 ? "bg-green-400" : c.points >= c.maxPoints * 0.4 ? "bg-amber-400" : "bg-red-400"}`}
                            style={{ width: `${(c.points / c.maxPoints) * 100}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{c.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {scoreBreakdown?.scoredAt && (
                <p className="text-[11px] text-muted-foreground">Last scored {format(new Date(scoreBreakdown.scoredAt), "MMM d, yyyy h:mm a")}</p>
              )}
            </>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No score yet</p>
              <p className="text-xs mt-1">Click Recalculate to generate a score</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Contact & Deal Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
            {fields.map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{f.label}</dt>
                <dd className="text-sm font-medium capitalize">{f.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <LeadDeals />
    </div>
  );
}
