import { useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDealSubmissionsQueryKey, getGetLeadSubmissionsQueryKey,
  getGetDealQueryKey, getListDealActivityQueryKey,
  useCreateManualLeadSubmission, useGetDealSubmissions, useGetLeadSubmissions,
  useListLenders, useUpdateSubmission,
  useUpdateDeal,
  downloadDocument, downloadSubmissionApprovalAttachment,
  downloadExactSubmissionPackage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { submissionSummary, shouldPromptForStage } from "@/lib/lenderSubmissions";
import { InlineListError } from "@/components/inline-list-error";
import { listData } from "@/lib/list-response";
import { getQueryErrorStatus } from "@/lib/query-error";

type Props = { leadId: number; dealId?: number; onStageMove?: (stage: "approved" | "declined") => void };
const colors: Record<string, string> = { submitted: "bg-blue-50 text-blue-700", approved: "bg-green-50 text-green-700", declined: "bg-red-50 text-red-700", funded: "bg-emerald-50 text-emerald-700", withdrawn: "bg-slate-50 text-slate-600" };

export function LenderSubmissionsPanel({ leadId, dealId, onStageMove }: Props) {
  const queryClient = useQueryClient();
  const leadQuery = useGetLeadSubmissions(leadId, { query: { queryKey: getGetLeadSubmissionsQueryKey(leadId), enabled: !dealId } });
  const dealQuery = useGetDealSubmissions(dealId ?? 0, { query: { queryKey: getGetDealSubmissionsQueryKey(dealId ?? 0), enabled: !!dealId } });
  const activeQuery = dealId ? dealQuery : leadQuery;
  const submissionList = listData<any>(activeQuery.data);
  const submissions = submissionList.items;
  const lendersQuery = useListLenders();
  const lenderList = listData<any>(lendersQuery.data);
  const lenders = lenderList.items;
  const update = useUpdateSubmission();
  const createManual = useCreateManualLeadSubmission();
  const updateDeal = useUpdateDeal();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ lender: "", date: new Date().toISOString().slice(0, 10), status: "submitted", notes: "" });
  const [pdf, setPdf] = useState<File | null>(null);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
    if (dealId) {
      queryClient.invalidateQueries({ queryKey: getGetDealSubmissionsQueryKey(dealId) });
      queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      queryClient.invalidateQueries({ queryKey: getListDealActivityQueryKey(dealId) });
    }
  };
  const saveManual = async () => {
    let approval_pdf_base64: string | undefined;
    if (pdf) approval_pdf_base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = reject; reader.readAsDataURL(pdf);
    });
    createManual.mutate({ id: leadId, data: { lender_id: Number(form.lender), deal_id: dealId, submitted_at: new Date(`${form.date}T12:00:00`).toISOString(), status: form.status as any, notes: form.notes || null, approval_pdf_base64 } }, { onSuccess: () => { refresh(); setOpen(false); setPdf(null); }, onError: () => undefined });
  };
  const changeStatus = (sub: any, status: string) => {
    update.mutate({ id: sub.id, data: { status: status as any } }, { onSuccess: () => {
      refresh();
      if ((dealId || sub.dealId) && (status === "approved" || status === "declined")) {
        const decision = shouldPromptForStage([...submissions.filter((s) => s.id !== sub.id), { status }], status);
        if (decision.prompt && window.confirm(`Move this deal to ${decision.stage === "approved" ? "Approved" : "Declined"} now? This is optional and will not happen automatically.`)) {
          if (onStageMove) onStageMove(decision.stage!);
          else if (sub.dealId) updateDeal.mutate({ id: sub.dealId, data: { stage: decision.stage! } });
        }
      }
    } });
  };
  const summary = submissionSummary(submissions);
  const downloadApproval = async (submission: any) => {
    if (submission.approvalDocumentId) {
      const result = await downloadDocument(submission.approvalDocumentId);
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const blob = await downloadSubmissionApprovalAttachment(submission.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Lender-Approval-${submission.id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const downloadPackage = async (submission: any) => {
    const blob = await downloadExactSubmissionPackage(submission.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MBS-Submission-${submission.id}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return <section className="space-y-3 rounded-lg border bg-white p-4" data-testid="lender-submissions-panel">
    <div className="flex items-center justify-between"><h3 className="font-semibold">Lender submissions</h3><Button size="sm" onClick={() => setOpen(true)}>Log submission</Button></div>
    {(activeQuery.isError || submissionList.malformed) && <InlineListError title="Couldn’t load lender submissions" status={activeQuery.isError ? getQueryErrorStatus(activeQuery.error) : 200} detail={submissionList.malformed ? "The server returned an unexpected submissions response." : undefined} onRetry={() => void activeQuery.refetch()} />}
    <div className="text-sm font-medium">{summary.text}</div>
    {submissions.map((s) => <div key={s.id} className="grid gap-2 border-t pt-2 text-sm md:grid-cols-[1fr_auto]"><div><b>{s.lender?.name ?? `Lender #${s.lenderId}`}</b><div className="text-xs text-muted-foreground">Date submitted: {format(new Date(s.sentAt), "MMM d, yyyy")} · Source: {s.source ?? "crm"}</div><div className="text-xs text-muted-foreground">Decision date: {s.decisionDate ? format(new Date(s.decisionDate), "MMM d, yyyy") : "—"}</div><div className="flex gap-3">{s.hasApprovalAttachment && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => void downloadApproval(s)}>Download approval attachment</Button>}{s.hasExactPackage && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => void downloadPackage(s)}>Download sent package</Button>}</div><Input className="mt-1 h-7 text-xs" defaultValue={s.notes ?? ""} placeholder="Notes" onBlur={(e) => { if (e.target.value !== (s.notes ?? "")) update.mutate({ id: s.id, data: { notes: e.target.value } }, { onSuccess: refresh }); }} /></div><Select value={s.status} onValueChange={(v) => changeStatus(s, v)}><SelectTrigger className={`h-7 w-28 text-xs ${colors[s.status] ?? ""}`}><SelectValue /></SelectTrigger><SelectContent>{["submitted", "approved", "declined", "funded", "withdrawn"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div>)}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Log lender submission</DialogTitle></DialogHeader><div className="space-y-3">{(lendersQuery.isError || lenderList.malformed) && <InlineListError title="Couldn’t load lenders" status={lendersQuery.isError ? getQueryErrorStatus(lendersQuery.error) : 200} detail={lenderList.malformed ? "The server returned an unexpected lender response." : undefined} onRetry={() => void lendersQuery.refetch()} />}<Label>Lender</Label><Select value={form.lender} onValueChange={(v) => setForm({ ...form, lender: v })}><SelectTrigger><SelectValue placeholder="Select lender" /></SelectTrigger><SelectContent>{lenders.map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent></Select><Label>Date submitted</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /><Label>Status</Label><Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}><SelectTrigger /><SelectContent>{["submitted", "approved", "declined", "funded", "withdrawn"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /><Label>Approval PDF (optional)</Label><Input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} /><Button disabled={!form.lender || createManual.isPending} onClick={saveManual}>{createManual.isPending ? "Saving…" : "Save submission"}</Button></div></DialogContent></Dialog>
  </section>;
}