import { useState, useRef, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetDeal, getGetDealQueryKey,
  useGetMe,
  useUpdateDeal,
  useListDealActivity,
  useListUsers,
  DealStage,
  useArchiveDeal,
  useGetDealSubmissions,
  getGetDealSubmissionsQueryKey,
  useUpdateSubmission,
  downloadExactSubmissionPackage
} from "@workspace/api-client-react";
import { cn, getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, DollarSign, Building2, Calendar, FileText, ChevronRight, Activity, ArrowUpRight, Check, X, ShieldCheck, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { Label } from "@/components/ui/label";
import { DetailLoadError } from "@/components/detail-load-error";
import { getQueryErrorStatus } from "@/lib/query-error";
import { DEAL_STAGE_COLUMNS } from "@/lib/dealBoard";

function mutationErrorMessage(error: any, fallback: string) {
  return error?.data?.error ?? error?.data?.message ?? error?.message ?? fallback;
}

function SubmissionRow({ submission, dealId }: { submission: any; dealId: number }) {
  const queryClient = useQueryClient();
  const updateSub = useUpdateSubmission();
  const { toast } = useToast();

  const [status, setStatus] = useState(submission.status);
  const [notes, setNotes] = useState(submission.notes || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const lastSavedNotes = useRef(notes);

  useEffect(() => {
    setStatus(submission.status);
    setNotes(submission.notes || "");
    lastSavedNotes.current = submission.notes || "";
  }, [submission.status, submission.notes]);

  const saveUpdates = (updates: any) => {
    updateSub.mutate({ id: submission.id, data: updates }, {
      onSuccess: () => {
        if (updates.notes !== undefined) lastSavedNotes.current = updates.notes;
        toast({ title: "Submission updated" });
        queryClient.invalidateQueries({ queryKey: getGetDealSubmissionsQueryKey(dealId) });
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      },
      onError: (err: any) => {
        toast({
          title: "Update failed",
          description: mutationErrorMessage(err, "Update failed"),
          variant: "destructive",
        });
        // Revert local state on error
        if (updates.status) setStatus(submission.status);
        if (updates.notes !== undefined) setNotes(submission.notes || "");
      }
    });
  };

  const handleStatusChange = (val: string) => {
    setStatus(val);
    saveUpdates({ status: val });
  };

  const handleNotesBlur = () => {
    setIsEditingNotes(false);
    if (notes !== lastSavedNotes.current) {
      saveUpdates({ notes });
    }
  };

  const statusColor: Record<string, string> = {
    submitted: "bg-blue-50 text-blue-700 border-blue-200",
    approved: "bg-green-50 text-green-700 border-green-200",
    declined: "bg-red-50 text-red-700 border-red-200",
    funded: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm bg-white">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{submission.lender?.name ?? `Lender #${submission.lenderId}`}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Sent {format(new Date(submission.sentAt), "MMM d, yyyy h:mm a")}
            {submission.sentByUser && ` by ${getUserDisplayName(submission.sentByUser)}`}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", statusColor[status] ?? "bg-slate-50 text-slate-500")}>
            {status}
          </span>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="h-7 text-xs w-[110px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
              <SelectItem value="funded">Funded</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mt-1">
        {isEditingNotes ? (
          <Input
            autoFocus
            className="h-8 text-xs bg-slate-50 border-slate-200"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            onKeyDown={(e) => e.key === "Enter" && handleNotesBlur()}
            placeholder="Add lender response notes..."
          />
        ) : (
          <div
            className={cn("text-xs rounded-md px-2 py-1.5 cursor-text border border-transparent hover:bg-slate-50 hover:border-slate-200 transition-colors", !notes && "text-muted-foreground italic")}
            onClick={() => setIsEditingNotes(true)}
          >
            {notes || "Click to add notes..."}
          </div>
        )}
      </div>
      {submission.hasExactPackage && (
        <Button variant="link" className="h-auto w-fit px-1 text-xs" onClick={() => downloadExactSubmissionPackage(submission.id).then((blob) => { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `MBS-Submission-${submission.id}.pdf`; link.click(); URL.revokeObjectURL(url); }).catch(() => toast({ title: "Download failed", variant: "destructive" }))}>
          <Download className="mr-1 h-3 w-3" /> Re-download the exact package sent
        </Button>
      )}
    </div>
  );
}

const STAGES = DEAL_STAGE_COLUMNS;

export default function DealDetail() {
  const { id } = useParams();
  const dealId = Number(id);
  const [, setLocation] = useLocation();

  const {
    data: deal,
    isLoading: dealLoading,
    error: dealError,
    refetch: refetchDeal,
  } = useGetDeal(dealId, { query: { queryKey: getGetDealQueryKey(dealId) } });
  const { data: activities, isLoading: activityLoading } = useListDealActivity(dealId);
  const { data: users } = useListUsers({ role: "rep", isActive: true });
  const { data: me } = useGetMe();

  const { data: submissions } = useGetDealSubmissions(dealId, { query: { queryKey: getGetDealSubmissionsQueryKey(dealId), enabled: !!dealId } });
  const updateDeal = useUpdateDeal();
  const archiveDeal = useArchiveDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    dealName: "",
    amount: "",
    approxGm: "",
    actualGm: "",
    stage: "",
    assignedTo: ""
  });

  useEffect(() => {
    if (deal && !editMode) {
      setFormData({
        dealName: deal.dealName || "",
        amount: deal.amount ? String(deal.amount) : "",
        approxGm: deal.approxGm ? String(deal.approxGm) : "",
        actualGm: deal.actualGm ? String(deal.actualGm) : "",
        stage: deal.stage || "",
        assignedTo: deal.assignedTo ? String(deal.assignedTo) : "unassigned"
      });
    }
  }, [deal, editMode]);

  const handleSave = () => {
    if (!formData.dealName) return void toast({ title: "Deal name required", variant: "destructive" });

    updateDeal.mutate({ 
      id: dealId, 
      data: {
        dealName: formData.dealName,
        amount: formData.amount ? Number(formData.amount) : null,
        approxGm: formData.approxGm ? Number(formData.approxGm) : null,
        actualGm: formData.actualGm ? Number(formData.actualGm) : null,
        stage: formData.stage as any,
        assignedTo: formData.assignedTo === "unassigned" ? null : Number(formData.assignedTo)
      } 
    }, {
      onSuccess: () => {
        toast({ title: "Deal saved" });
        setEditMode(false);
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      },
      onError: (err: any) => {
        const msg = err.response?.data?.message || err.message;
        toast({ title: "Error saving deal", description: msg, variant: "destructive" });
      }
    });
  };

  const handleArchive = () => {
    if (!confirm("Are you sure you want to archive this deal?")) return;
    archiveDeal.mutate({ id: dealId }, {
      onSuccess: () => {
        toast({ title: "Deal archived" });
        setLocation("/deals");
      }
    });
  };

  if (dealLoading) {
    return (
      <div className="flex-1 p-6 space-y-6 bg-[#f8fafc]">
        <Skeleton className="h-10 w-48" />
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (getQueryErrorStatus(dealError) === 404) {
    return (
      <div className="flex-1 p-6 bg-[#f8fafc] flex flex-col items-center justify-center">
        <h2 className="text-xl font-semibold">Deal not found</h2>
        <Link href="/deals"><Button variant="link" className="mt-2">Back to Deals</Button></Link>
      </div>
    );
  }

  if (dealError || !deal) {
    return (
      <DetailLoadError
        entity="deal"
        error={dealError}
        isAdmin={me?.role === "admin"}
        onRetry={() => {
          void refetchDeal();
        }}
      />
    );
  }

  const assignedRep = users?.find(u => u.id === deal.assignedTo);
  const currentStage = STAGES.find(s => s.id === deal.stage)?.label || deal.stage;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <div className="flex-none px-6 py-4 border-b bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sticky top-0 z-[var(--z-header)] shadow-sm">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <Link href="/deals" className="shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 rounded-full text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-[#0E2A47] truncate">{deal.dealName}</h1>
              {deal.isArchived && <Badge variant="secondary" className="bg-slate-100 text-slate-700 shrink-0">Archived</Badge>}
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 shrink-0">{currentStage}</Badge>
            </div>
            {deal.leadId && deal.lead && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                Linked to Lead: 
                <Link href={`/leads/${deal.leadId}`} className="text-primary hover:underline font-medium flex items-center gap-1 truncate max-w-[200px]">
                  <span className="truncate">{(deal.lead as any).firstName} {(deal.lead as any).lastName}</span> <ArrowUpRight className="w-3 h-3 shrink-0" />
                </Link>
              </p>
            )}
            {deal.lastActivityAt && (
              <p className="text-xs text-muted-foreground mt-1 truncate">
                Last activity {formatDistanceToNow(new Date(deal.lastActivityAt), { addSuffix: true })} · {getUserDisplayName(deal.lastActivityActor, "System")}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end sm:justify-start">
          {editMode ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditMode(false)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={updateDeal.isPending || !formData.dealName}><Check className="w-4 h-4 mr-1" /> Save</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>Edit Details</Button>
              {!deal.isArchived && <Button variant="secondary" size="sm" onClick={handleArchive}>Archive</Button>}
            </>
          )}
        </div>
      </div>

      <div className="p-6 max-w-[1200px] w-full mx-auto grid lg:grid-cols-[1fr_400px] gap-6">
        <div className="space-y-6">
          <Card className="shadow-sm border-gray-200/60 overflow-hidden">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Deal Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {editMode ? (
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2 space-y-1.5">
                    <Label>Deal name <span className="text-red-500">*</span></Label>
                    <Input value={formData.dealName} onChange={e => setFormData(f => ({...f, dealName: e.target.value}))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Stage</Label>
                    <Select value={formData.stage} onValueChange={v => setFormData(f => ({...f, stage: v}))}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Assigned rep</Label>
                    <Select value={formData.assignedTo} onValueChange={v => setFormData(f => ({...f, assignedTo: v}))}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{getUserDisplayName(u)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount</Label>
                    <div className="relative mt-1.5">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" placeholder="0.00" value={formData.amount} onChange={e => setFormData(f => ({...f, amount: e.target.value}))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expected GM</Label>
                    <div className="relative mt-1.5">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" placeholder="0.00" value={formData.approxGm} onChange={e => setFormData(f => ({...f, approxGm: e.target.value}))} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Actual GM (Funded only)</Label>
                    <div className="relative mt-1.5">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" placeholder="0.00" value={formData.actualGm} onChange={e => setFormData(f => ({...f, actualGm: e.target.value}))} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-8">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Amount</div>
                    <div className="text-lg font-semibold text-[#0E2A47]">{deal.amount ? `$${deal.amount.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Expected GM</div>
                    <div className="text-lg font-semibold text-emerald-600">{deal.approxGm ? `$${deal.approxGm.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Actual GM</div>
                    <div className="text-lg font-semibold text-[#149258]">{deal.actualGm ? `$${deal.actualGm.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Assigned Rep</div>
                    <div className="text-sm font-medium flex items-center gap-2 text-gray-700">
                      <User className="h-4 w-4 text-muted-foreground" /> {assignedRep ? getUserDisplayName(assignedRep) : "Unassigned"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Created</div>
                    <div className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" /> {format(new Date(deal.createdAt), "MMM d, yyyy")}
                    </div>
                  </div>
                  {deal.fundedAt && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Funded At</div>
                      <div className="text-sm font-medium text-[#149258] flex items-center gap-2">
                        <Check className="h-4 w-4" /> {format(new Date(deal.fundedAt), "MMM d, yyyy")}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-gray-200/60 overflow-hidden">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Lender Submissions</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {!submissions ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : submissions.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                  No submissions yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {submissions.map((sub: any) => (
                    <SubmissionRow key={sub.id} submission={sub} dealId={dealId} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="shadow-sm border-gray-200/60 overflow-hidden h-full flex flex-col">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4 shrink-0">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" /> Activity Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {activityLoading ? (
                <div className="p-4 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : activities?.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>
              ) : (
                <div className="p-6 relative">
                  <div className="absolute left-[35px] top-6 bottom-6 w-0.5 bg-gray-100" />
                  <div className="space-y-6">
                    {activities?.map(activity => {
                      const isStageChange = activity.action === "stage_changed";
                      const oldStage = STAGES.find(s => s.id === (activity.details as any)?.oldStage)?.label || (activity.details as any)?.oldStage;
                      const newStage = STAGES.find(s => s.id === (activity.details as any)?.newStage)?.label || (activity.details as any)?.newStage;
                      
                      return (
                        <div key={activity.id} className="relative flex items-start gap-4 z-[var(--z-header)] min-w-0">
                          <div className={cn("h-8 w-8 rounded-full border-2 border-white flex items-center justify-center shrink-0 shadow-sm", isStageChange ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500")}>
                            {isStageChange ? <ChevronRight className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 break-words [overflow-wrap:anywhere]">
                              {isStageChange ? (
                                <>Moved to <span className="font-semibold text-blue-700">{newStage}</span></>
                              ) : (
                                activity.action
                              )}
                            </p>
                            {isStageChange && oldStage && (
                              <p className="text-xs text-muted-foreground mt-0.5 break-words">from {oldStage}</p>
                            )}
                            <div className="text-[11px] text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="whitespace-nowrap">{format(new Date(activity.createdAt), "MMM d, h:mm a")}</span>
                              {activity.user && <span className="truncate max-w-[120px] sm:max-w-full" title={`by ${getUserDisplayName(activity.user)}`}>· by {getUserDisplayName(activity.user)}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
