import { useState, useRef, useEffect, useContext } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetDeal, getGetDealQueryKey,
  useGetMe,
  useUpdateDeal,
  useListDealActivity,
  useListUsers,
  DealStage,
  useArchiveDeal,
  useListDealApprovals,
  getListDealApprovalsQueryKey,
  useCreateDealApproval,
  useListLenders,
  useUploadDocument,
  useCreateNote,
  useCreateTask,
  getListNotesQueryKey,
  getListTasksQueryKey,
  getListDocumentsQueryKey,
  getListLeadActivityQueryKey,
} from "@workspace/api-client-react";
import { cn, getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, DollarSign, Building2, Calendar, FileText, ChevronRight, Activity, ArrowUpRight, Check, X, ShieldCheck, Download, Plus, Mail, Phone, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { Label } from "@/components/ui/label";
import { DetailLoadError } from "@/components/detail-load-error";
import { getQueryErrorStatus } from "@/lib/query-error";
import { DEAL_STAGE_COLUMNS } from "@/lib/dealBoard";
import { approvalDaysUntil, approvalToCalculatorPrefill, latestApproval } from "@/lib/dealApproval";
import { LenderSubmissionsPanel } from "@/components/lender-submissions-panel";
import { InlineListError } from "@/components/inline-list-error";
import { listData } from "@/lib/list-response";
import { EmailLink, PhoneLink } from "@/components/phone-link";
import { RecordActionBar, type RecordActionItem } from "@/components/record-action-bar";
import { SoftphoneContext } from "@/components/softphone-context";
import { contactName, formatDealIdentity } from "@/lib/recordIdentity";
import { dealActionAvailable } from "@/lib/recordActions";
import { isMobileWeb, phoneActionForDevice } from "@/lib/recordContact";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

function mutationErrorMessage(error: any, fallback: string) {
  return error?.data?.error ?? error?.data?.message ?? error?.message ?? fallback;
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

  const approvalsQuery = useListDealApprovals(dealId, { query: { queryKey: getListDealApprovalsQueryKey(dealId), enabled: !!dealId } });
  const approvalsList = listData<any>(approvalsQuery.data);
  const approvals = approvalsList.items;
  const lendersQuery = useListLenders();
  const lendersList = listData<any>(lendersQuery.data);
  const lenders = lendersList.items;
  const updateDeal = useUpdateDeal();
  const createApproval = useCreateDealApproval();
  const uploadDocument = useUploadDocument();
  const createNote = useCreateNote();
  const createTask = useCreateTask();
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
  const [approvalForm, setApprovalForm] = useState({
    lenderId: "",
    contractType: "EFA",
    advance: "",
    payment: "",
    term: "",
    downPayment: "0",
    tier: "",
    expiresOn: "",
  });
  const [approvalFile, setApprovalFile] = useState<File | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const actionUploadRef = useRef<HTMLInputElement>(null);
  const {
    dial,
    softphoneAvailable,
    openTextComposer,
    openEmailComposer,
  } = useContext(SoftphoneContext);
  const latest = latestApproval(approvals as Array<{
    id: number;
    createdAt: string;
    lenderName: string;
    contractType: string;
    advance: number;
    payment: number;
    term: number;
    expiresOn: string;
  }>);
  const calculatorPrefill = approvalToCalculatorPrefill(latest);

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

  const saveApproval = async () => {
    const leadId = deal?.leadId;
    if (!approvalForm.lenderId || !approvalForm.advance || !approvalForm.payment ||
        !approvalForm.term || !approvalForm.tier || !approvalForm.expiresOn) {
      toast({ title: "Complete all approval fields", variant: "destructive" });
      return;
    }
    if (approvalFile && !leadId) {
      toast({
        title: "Link this deal to a lead first",
        description: "An approval PDF can only be uploaded for a deal linked to a lead.",
        variant: "destructive",
      });
      return;
    }
    try {
      let approvalDocumentId: number | null = null;
      if (approvalFile) {
        const uploaded = await uploadDocument.mutateAsync({
          id: leadId!,
          data: { file: approvalFile, category: "other", label: "Approval" },
        });
        approvalDocumentId = uploaded.id;
      }
      await createApproval.mutateAsync({
        id: dealId,
        data: {
          lenderId: Number(approvalForm.lenderId),
          contractType: approvalForm.contractType as "EFA" | "lease" | "loan",
          advance: Number(approvalForm.advance),
          payment: Number(approvalForm.payment),
          term: Number(approvalForm.term),
          downPayment: Number(approvalForm.downPayment || 0),
          tier: approvalForm.tier,
          expiresOn: approvalForm.expiresOn,
          approvalDocumentId,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListDealApprovalsQueryKey(dealId) });
      setApprovalOpen(false);
      setApprovalFile(null);
      toast({ title: "Approval captured" });
    } catch (error: any) {
      toast({ title: "Could not capture approval", description: mutationErrorMessage(error, "Please try again"), variant: "destructive" });
    }
  };

  const actionLeadId = deal?.leadId ?? null;
  const handleAddDealNote = async () => {
    if (!actionLeadId || !noteBody.trim()) return;
    try {
      await createNote.mutateAsync({ id: actionLeadId, data: { body: noteBody.trim() } });
      setNoteBody("");
      setNoteOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(actionLeadId) }),
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(actionLeadId) }),
      ]);
      toast({ title: "Note added to linked lead" });
    } catch (error) {
      toast({ title: "Could not add note", description: mutationErrorMessage(error, "Please try again."), variant: "destructive" });
    }
  };

  const handleAddDealTask = async () => {
    if (!actionLeadId || !taskTitle.trim()) return;
    try {
      await createTask.mutateAsync({ id: actionLeadId, data: { title: taskTitle.trim(), dueDate: taskDueDate || undefined } });
      setTaskTitle("");
      setTaskDueDate("");
      setTaskOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(actionLeadId) }),
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(actionLeadId) }),
      ]);
      toast({ title: "Task added to linked lead" });
    } catch (error) {
      toast({ title: "Could not add task", description: mutationErrorMessage(error, "Please try again."), variant: "destructive" });
    }
  };

  const handleDealActionUpload = async (file?: File) => {
    if (!file || !actionLeadId) return;
    try {
      await uploadDocument.mutateAsync({ id: actionLeadId, data: { file, category: "other" } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(actionLeadId) }),
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(actionLeadId) }),
      ]);
      toast({ title: "Document uploaded to linked lead" });
    } catch (error) {
      toast({ title: "Document upload failed", description: mutationErrorMessage(error, "Please try again."), variant: "destructive" });
    } finally {
      if (actionUploadRef.current) actionUploadRef.current.value = "";
    }
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
  const identity = formatDealIdentity(deal);
  const authorizedLead = (deal as any).lead ?? null;
  const displayContactName = authorizedLead ? contactName(authorizedLead) : deal.contactName?.trim() || "";
  const displayPhone = (authorizedLead?.phone ?? deal.contactPhone)?.trim() || null;
  const displayEmail = (authorizedLead?.email ?? deal.contactEmail)?.trim() || null;
  const displayAddress = (authorizedLead?.businessAddress ?? deal.businessAddress)?.trim() || null;
  const contactLeadId = actionLeadId;
  const actionContact = { leadId: contactLeadId, phone: displayPhone, email: displayEmail };
  const actions: RecordActionItem[] = [
    {
      action: "upload",
      disabled: !dealActionAvailable("upload", actionContact),
      disabledReason: "Link this deal to an accessible lead to upload documents.",
      onClick: () => actionUploadRef.current?.click(),
    },
    { action: "edit", onClick: () => setEditMode(true) },
    {
      action: "call",
      disabled: !dealActionAvailable("call", actionContact),
      disabledReason: "Phone number unavailable.",
      onClick: () => {
        if (!displayPhone) return;
        if (phoneActionForDevice(isMobileWeb({
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          viewportWidth: window.innerWidth,
          pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
        }), softphoneAvailable) === "softphone") dial(displayPhone, { autoCall: true, leadId: contactLeadId ?? undefined });
        else window.location.href = `tel:${displayPhone.replace(/[^\d+]/g, "")}`;
      },
    },
    {
      action: "text",
      disabled: !dealActionAvailable("text", actionContact),
      disabledReason: !displayPhone?.trim() ? "Phone number unavailable." : "Text requires a linked lead for application-scoped consent checks.",
      onClick: () => {
        if (!contactLeadId) return;
        openTextComposer(contactLeadId);
        setLocation(`/leads/${contactLeadId}`);
      },
    },
    {
      action: "email",
      disabled: !dealActionAvailable("email", actionContact),
      disabledReason: "Email address unavailable.",
      onClick: () => {
        if (!displayEmail) return;
        if (!contactLeadId) {
          window.location.href = `mailto:${displayEmail}`;
          return;
        }
        openEmailComposer(contactLeadId);
        setLocation(`/leads/${contactLeadId}?compose=email`);
      },
    },
    {
      action: "note",
      disabled: !dealActionAvailable("note", actionContact),
      disabledReason: "Link this deal to an accessible lead to add notes.",
      onClick: () => setNoteOpen(true),
    },
    {
      action: "task",
      disabled: !dealActionAvailable("task", actionContact),
      disabledReason: "Link this deal to an accessible lead to add tasks.",
      onClick: () => setTaskOpen(true),
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <RecordActionBar items={actions} />
      <div className="flex-none px-4 py-4 border-b bg-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <Link href="/deals" className="shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 rounded-full text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
               <h1 className="text-xl font-bold text-[#0E2A47] break-words">{identity}</h1>
              {deal.isArchived && <Badge variant="secondary" className="bg-slate-100 text-slate-700 shrink-0">Archived</Badge>}
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 shrink-0">{currentStage}</Badge>
            </div>
            {deal.dealName?.trim() && deal.dealName.trim() !== identity && (
              <p className="text-xs text-muted-foreground mt-1 break-words">Deal name: {deal.dealName}</p>
            )}
            {deal.leadId && authorizedLead && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                Linked to Lead: 
                <Link href={`/leads/${deal.leadId}`} className="text-primary hover:underline font-medium flex items-center gap-1 truncate max-w-[200px]">
                  <span className="truncate">{formatDealIdentity(deal)}</span> <ArrowUpRight className="w-3 h-3 shrink-0" />
                </Link>
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">{displayContactName || "Contact name unavailable"}</span>
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {displayPhone ? <PhoneLink phone={displayPhone} leadId={contactLeadId ?? undefined} showIcon={false} className="min-h-11 text-xs" /> : "Phone unavailable"}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                {displayEmail ? <EmailLink email={displayEmail} leadId={contactLeadId ?? undefined} showIcon={false} className="min-h-11 break-all text-xs" /> : "Email unavailable"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {displayAddress?.trim() || "Business address unavailable"}
              </span>
            </div>
            {!contactLeadId && (
              <p className="mt-2 max-w-2xl text-xs text-amber-800">
                No accessible lead is linked. Documents, notes, tasks and CRM texting need an authorized linked lead.
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

      <input
        ref={actionUploadRef}
        type="file"
        className="hidden"
        aria-label="Upload document to linked lead"
        onChange={(event) => void handleDealActionUpload(event.target.files?.[0])}
      />

      <div className="p-4 pb-28 md:p-6 md:pb-28 max-w-[1200px] w-full mx-auto grid lg:grid-cols-[1fr_400px] gap-6">
        <div className="space-y-6">
          <Card className="shadow-sm border-gray-200/60 overflow-hidden">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Deal Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {(approvalsQuery.isError || approvalsList.malformed) && <InlineListError title="Couldn’t load approvals" status={approvalsQuery.isError ? getQueryErrorStatus(approvalsQuery.error) : 200} detail={approvalsList.malformed ? "The server returned an unexpected approvals response." : undefined} onRetry={() => void approvalsQuery.refetch()} />}
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
                    <SearchableSelect
                      value={formData.assignedTo}
                      onValueChange={v => setFormData(f => ({...f, assignedTo: v}))}
                      placeholder=""
                      className="bg-white"
                      options={[
                        { value: "unassigned", label: "Unassigned" },
                        ...(users ?? []).map(u => ({ value: String(u.id), label: getUserDisplayName(u) })),
                      ]}
                    />
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
                   {(deal as any).referredByPartnerId && (
                     <div>
                       <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Referral partner</div>
                       <div className="text-sm font-medium text-[#0E2A47]">Partner #{(deal as any).referredByPartnerId} · {(deal as any).referralSplitPct ?? 0}% split</div>
                     </div>
                   )}
                   {(deal as any).referralGm != null && (
                     <div>
                       <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Net GM after referral</div>
                       <div className="text-lg font-semibold text-emerald-600">${Number((deal as any).referralGm).toLocaleString()}</div>
                     </div>
                   )}
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
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Latest Approval</CardTitle>
                {latest && <CardDescription className="mt-1">{latest.lenderName} · {latest.contractType}</CardDescription>}
              </div>
              <Button size="sm" variant={approvalOpen ? "outline" : "default"} onClick={() => setApprovalOpen((open) => !open)}>
                {approvalOpen ? <X className="w-4 h-4 mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
                {approvalOpen ? "Cancel" : "Add approval"}
              </Button>
            </CardHeader>
            <CardContent className="p-6">
              {latest && !approvalOpen && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm mb-5">
                  <div><div className="text-xs text-muted-foreground">Advance</div><div className="font-semibold">${Number(latest.advance).toLocaleString()}</div></div>
                  <div><div className="text-xs text-muted-foreground">Payment</div><div className="font-semibold">${Number(latest.payment).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div></div>
                  <div><div className="text-xs text-muted-foreground">Term</div><div className="font-semibold">{latest.term} payments</div></div>
                  <div><div className="text-xs text-muted-foreground">Expiry</div><div className={cn("font-semibold", approvalDaysUntil(latest.expiresOn) < 0 ? "text-red-600" : "text-emerald-600")}>{approvalDaysUntil(latest.expiresOn)} days</div></div>
                </div>
              )}
              {!latest && !approvalOpen && <div className="text-sm text-muted-foreground py-2">No lender approval captured yet.</div>}
              {latest && !approvalOpen && (
                <Link href={`/deals/rate-points?dealId=${dealId}&advance=${encodeURIComponent(calculatorPrefill?.amount ?? "")}&payment=${encodeURIComponent(calculatorPrefill?.payment ?? "")}&term=${encodeURIComponent(calculatorPrefill?.term ?? "")}`}>
                  <Button variant="outline" size="sm"><FileText className="w-4 h-4 mr-1" />Open calculator with approval</Button>
                </Link>
              )}
              {approvalOpen && (
                <div className="grid grid-cols-2 gap-4">
                  {(lendersQuery.isError || lendersList.malformed) && <div className="col-span-2"><InlineListError title="Couldn’t load lenders" status={lendersQuery.isError ? getQueryErrorStatus(lendersQuery.error) : 200} detail={lendersList.malformed ? "The server returned an unexpected lender response." : undefined} onRetry={() => void lendersQuery.refetch()} /></div>}
                  <div className="col-span-2 space-y-1.5"><Label>Lender</Label><SearchableSelect value={approvalForm.lenderId} onValueChange={(value) => setApprovalForm((f) => ({ ...f, lenderId: value }))} placeholder="Select lender" options={lenders.map((lender) => ({ value: String(lender.id), label: lender.name }))} /></div>
                  <div className="space-y-1.5"><Label>Contract type</Label><Select value={approvalForm.contractType} onValueChange={(value) => setApprovalForm((f) => ({ ...f, contractType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EFA">EFA</SelectItem><SelectItem value="lease">Lease</SelectItem><SelectItem value="loan">Loan</SelectItem></SelectContent></Select></div>
                  <div className="space-y-1.5"><Label>Tier</Label><Input value={approvalForm.tier} onChange={(e) => setApprovalForm((f) => ({ ...f, tier: e.target.value }))} placeholder="A" /></div>
                  <div className="space-y-1.5"><Label>Advance</Label><Input type="number" step="0.01" value={approvalForm.advance} onChange={(e) => setApprovalForm((f) => ({ ...f, advance: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Payment</Label><Input type="number" step="0.01" value={approvalForm.payment} onChange={(e) => setApprovalForm((f) => ({ ...f, payment: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Term</Label><Input type="number" min="1" value={approvalForm.term} onChange={(e) => setApprovalForm((f) => ({ ...f, term: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Down payment</Label><Input type="number" step="0.01" value={approvalForm.downPayment} onChange={(e) => setApprovalForm((f) => ({ ...f, downPayment: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Expiry date</Label><Input type="date" value={approvalForm.expiresOn} onChange={(e) => setApprovalForm((f) => ({ ...f, expiresOn: e.target.value }))} /></div>
                  <div className="col-span-2 space-y-1.5"><Label>Approval PDF (optional)</Label><Input type="file" accept="application/pdf,.pdf" onChange={(e) => setApprovalFile(e.target.files?.[0] ?? null)} /><p className="text-xs text-muted-foreground">Saved as document category “other” with label “Approval”.</p></div>
                  <div className="col-span-2 flex justify-end"><Button onClick={saveApproval} disabled={createApproval.isPending || uploadDocument.isPending}>{createApproval.isPending || uploadDocument.isPending ? "Saving…" : "Save approval"}</Button></div>
                </div>
              )}
            </CardContent>
          </Card>

          <LenderSubmissionsPanel
            leadId={deal?.leadId ?? 0}
            dealId={dealId}
            onStageMove={(stage) => updateDeal.mutate({ id: dealId, data: { stage } as any }, {
              onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) }),
            })}
          />
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
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add note to linked lead</DialogTitle>
            <DialogDescription>This note is saved on the deal’s authorized linked lead.</DialogDescription>
          </DialogHeader>
          <Textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="Add a note…" className="min-h-28" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAddDealNote()} disabled={!noteBody.trim() || createNote.isPending}>
              {createNote.isPending ? "Saving…" : "Add note"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add task to linked lead</DialogTitle>
            <DialogDescription>This task is saved on the deal’s authorized linked lead.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="deal-action-task-title">Task title</Label>
              <Input id="deal-action-task-title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Follow up…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-action-task-due">Due date (optional)</Label>
              <Input id="deal-action-task-due" type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAddDealTask()} disabled={!taskTitle.trim() || createTask.isPending}>
              {createTask.isPending ? "Saving…" : "Add task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
