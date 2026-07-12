import { useState, useContext } from "react";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useGetLead, getGetLeadQueryKey, 
  useChangeLeadStatus, StatusChangeStatus,
  useUpdateLead, LeadUpdateApplicationType,
  useListNotes, getListNotesQueryKey, useCreateNote,
  useListTasks, getListTasksQueryKey, useCreateTask, useUpdateTask,
  useListDocuments, getListDocumentsQueryKey,
  useUploadDocument, downloadDocument,
  useListLeadActivity, getListLeadActivityQueryKey,
  useGetMe, useAssignLead, useListUsers,
  useListCommunications, getListCommunicationsQueryKey, useSendSms,
  useListLeadEmails, getListLeadEmailsQueryKey,
  useSendEmail, useListEmailTemplates, usePreviewEmailTemplate,
  useGetLeadDripEnrollment, getGetLeadDripEnrollmentQueryKey,
  useEnrollLeadInDrip, useUnenrollLeadFromDrip, useListDripSequences,
  useRunLenderMatch, useGetLenderMatches, getGetLenderMatchesQueryKey,
  useGetLeadSubmissions, getGetLeadSubmissionsQueryKey,
  useCreateLeadSubmission, useUpdateSubmission,
  useListFlyerTemplates, useGenerateFlyer, useEmailFlyer, getDownloadFlyerUrl,
  useGetLeadApplication, useGetLeadFinancials,
  useGetLeadCredit, useCaptureCreditConsent, usePullCreditReport,
  useRecalculateLeadScore,
  useGenerateLeadBriefing, useGenerateAiDraft, AiDraftRequestChannel,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArrowLeft, Building2, User, Phone, Mail, FileText, CheckSquare, Clock, Download, UploadCloud, Plus, Calendar as CalendarIcon, File as FileIcon, MessageSquare, PhoneCall, PhoneIncoming, PhoneOutgoing, ArrowUpRight, ArrowDownLeft, MailCheck, Zap, MailOpen, Star, RefreshCw, Send, CheckCircle2, XCircle, Megaphone, FileDown, Loader2, ClipboardList, BarChart3, TrendingUp, ShieldCheck, Copy, Sparkles, AlertTriangle, ListChecks } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PhoneLink } from "@/components/phone-link";
import { SoftphoneContext } from "@/components/softphone-context";

const formatStatus = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-green-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";
  const label = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  const labelColor = score >= 70 ? "text-green-700" : score >= 40 ? "text-amber-700" : "text-red-700";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold text-gray-900">{score}<span className="text-sm font-normal text-muted-foreground">/100</span></span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${score >= 70 ? "bg-green-100" : score >= 40 ? "bg-amber-100" : "bg-red-100"} ${labelColor}`}>{label}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

// Info Tab
function LeadInfo({ lead, leadId }: { lead: any; leadId: number }) {
  const { data: currentUser } = useGetMe();
  const { data: reps } = useListUsers({ role: "rep" });
  const assignLead = useAssignLead();
  const recalcScore = useRecalculateLeadScore();
  const generateBriefing = useGenerateLeadBriefing();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canAssign = currentUser?.role === "manager" || currentUser?.role === "admin";

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

  const handleAssign = (repIdStr: string) => {
    const repId = repIdStr === "unassigned" ? null : Number(repIdStr);
    assignLead.mutate(
      { id: leadId, data: { repId: repId as number } },
      {
        onSuccess: () => {
          toast({ title: "Lead Reassigned" });
          queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
        },
        onError: () => toast({ title: "Error", description: "Could not reassign lead.", variant: "destructive" }),
      },
    );
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

      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Assignment</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Assigned Rep</div>
              <div className="text-sm font-medium">
                {lead.assignedRep ? (
                  <span className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                      {lead.assignedRep.name?.charAt(0) || "U"}
                    </div>
                    {lead.assignedRep.name || lead.assignedRep.email}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Unassigned</span>
                )}
              </div>
            </div>
            {canAssign && reps && (
              <div className="w-52">
                <Select
                  value={lead.assignedRepId ? String(lead.assignedRepId) : "unassigned"}
                  onValueChange={handleAssign}
                  disabled={assignLead.isPending}
                >
                  <SelectTrigger className="h-9 text-sm bg-white">
                    <SelectValue placeholder="Assign to rep…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {reps.map((rep) => (
                      <SelectItem key={rep.id} value={String(rep.id)}>
                        {rep.name || rep.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Notes Tab
function LeadNotes({ leadId }: { leadId: number }) {
  const { data: notes, isLoading } = useListNotes(leadId, { query: { queryKey: getListNotesQueryKey(leadId) } });
  const createNote = useCreateNote();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newNote, setNewNote] = useState("");

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    createNote.mutate({ id: leadId, data: { body: newNote } }, {
      onSuccess: () => {
        setNewNote("");
        queryClient.invalidateQueries({ queryKey: getListNotesQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: () => toast({ title: "Error", description: "Could not add note", variant: "destructive" })
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <form onSubmit={handleAddNote} className="space-y-3 bg-white p-4 rounded-lg border shadow-sm">
        <Textarea 
          placeholder="Add a note about this deal..." 
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          className="min-h-[100px] resize-none"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={createNote.isPending || !newNote.trim()}>
            {createNote.isPending ? "Adding..." : "Add Note"}
          </Button>
        </div>
      </form>

      <div className="space-y-4">
        {isLoading ? (
          [1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)
        ) : notes?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No notes yet.</div>
        ) : (
          notes?.map((note) => (
            <div key={note.id} className="bg-white p-4 rounded-lg border shadow-sm space-y-2">
              <div className="flex justify-between items-start">
                <span className="font-medium text-sm">{note.author?.name || 'User'}</span>
                <span className="text-xs text-muted-foreground">{format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Tasks Tab
function LeadTasks({ leadId }: { leadId: number }) {
  const { data: tasks, isLoading } = useListTasks(leadId, { query: { queryKey: getListTasksQueryKey(leadId) } });
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate({ id: leadId, data: { title, dueDate: dueDate || undefined } }, {
      onSuccess: () => {
        setTitle("");
        setDueDate("");
        setIsOpen(false);
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: () => toast({ title: "Error", description: "Could not create task", variant: "destructive" })
    });
  };

  const handleToggle = (taskId: number, isCompleted: boolean) => {
    updateTask.mutate({ taskId, data: { isCompleted: !isCompleted } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) });
      }
    });
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Checklist & Tasks</h3>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-2" /> New Task</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Task</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up on bank statements..." autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Due Date (Optional)</Label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={createTask.isPending || !title.trim()}>Save Task</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          [1,2].map(i => <Skeleton key={i} className="h-14 w-full" />)
        ) : tasks?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No tasks assigned.</div>
        ) : (
          tasks?.map((task) => (
            <div key={task.id} className={`flex items-start gap-3 bg-white p-3 rounded-lg border shadow-sm transition-opacity ${task.isCompleted ? 'opacity-60' : ''}`}>
              <Checkbox 
                checked={task.isCompleted} 
                onCheckedChange={() => handleToggle(task.id, task.isCompleted)} 
                className="mt-1"
              />
              <div className="flex-1 space-y-1">
                <p className={`text-sm font-medium ${task.isCompleted ? 'line-through text-muted-foreground' : ''}`}>
                  {task.title}
                </p>
                {task.dueDate && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarIcon className="w-3 h-3" /> {format(new Date(task.dueDate), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Documents Tab
function LeadDocuments({ leadId }: { leadId: number }) {
  const { data: documents, isLoading } = useListDocuments(leadId, { query: { queryKey: getListDocumentsQueryKey(leadId) } });
  const uploadDocument = useUploadDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadDocument.mutate(
      { id: leadId, data: { file } },
      {
        onSuccess: () => {
          toast({ title: "Document Uploaded" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
        },
        onError: () => toast({ title: "Error", description: "Failed to upload document", variant: "destructive" }),
        onSettled: () => { if (e.target) e.target.value = ""; },
      },
    );
  };

  const handleDownload = async (docId: number, _filename: string) => {
    try {
      const result = await downloadDocument(docId);
      if (result.downloadUrl) window.open(result.downloadUrl, "_blank");
    } catch {
      toast({ title: "Download Error", description: "Could not download document.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex justify-between items-center">
        <h3 className="font-medium">Documents</h3>
        <div className="relative">
          <Input 
            type="file" 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
            onChange={handleUpload}
            disabled={uploadDocument.isPending}
          />
          <Button size="sm" variant="outline" disabled={uploadDocument.isPending}>
            {uploadDocument.isPending ? "Uploading..." : <><UploadCloud className="w-4 h-4 mr-2" /> Upload</>}
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : documents?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-gray-50/50">No documents found.</div>
        ) : (
          <div className="divide-y">
            {documents?.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded bg-blue-50 flex items-center justify-center text-blue-600">
                    <FileIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {(doc.fileSize / 1024).toFixed(1)} KB • {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => handleDownload(doc.id, doc.filename)}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Activity Tab
function LeadActivity({ leadId }: { leadId: number }) {
  const { data: activities, isLoading } = useListLeadActivity(leadId, { query: { queryKey: getListLeadActivityQueryKey(leadId) } });

  if (isLoading) return <div className="mt-4 space-y-4"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>;

  return (
    <div className="space-y-6 mt-4 relative">
      {activities?.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No activity yet.</div>
      ) : (
        <div className="space-y-6 pl-4 border-l-2 border-gray-200 ml-2 py-2">
          {activities?.map((activity) => (
            <div key={activity.id} className="relative">
              <div className="absolute -left-[23px] top-1 h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {activity.user?.name || "System"} <span className="font-normal text-muted-foreground">{activity.action}</span> {activity.entityType}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(activity.createdAt), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Email status badge helper
function EmailStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-slate-100 text-slate-600",
    sent: "bg-blue-50 text-blue-700",
    delivered: "bg-green-50 text-green-700",
    opened: "bg-purple-50 text-purple-700",
    clicked: "bg-indigo-50 text-indigo-700",
    bounced: "bg-red-50 text-red-700",
    unsubscribed: "bg-orange-50 text-orange-700",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${map[status] ?? "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}

// Drip enrollment status section
function LeadDripStatus({ leadId }: { leadId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: enrollment, isLoading } = useGetLeadDripEnrollment(leadId, { query: { queryKey: getGetLeadDripEnrollmentQueryKey(leadId) } });
  const { data: sequences } = useListDripSequences();
  const enroll = useEnrollLeadInDrip();
  const unenroll = useUnenrollLeadFromDrip();
  const [selectedSeq, setSelectedSeq] = useState<string>("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetLeadDripEnrollmentQueryKey(leadId) });
    queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
  };

  if (isLoading) return <Skeleton className="h-14 w-full" />;

  return (
    <div className="border rounded-lg p-3 bg-slate-50">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Drip Campaign</span>
      </div>
      {enrollment ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-700 font-medium">{(enrollment as any).sequence?.name ?? `Seq #${enrollment.sequenceId}`}</span>
            <Badge variant="outline" className="text-[10px]">Step {(enrollment as any).currentStep + 1} / {(enrollment as any).sequence?.steps ?? "?"}</Badge>
            <Badge className={`text-[10px] capitalize ${enrollment.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
              {enrollment.status}
            </Badge>
          </div>
          {(enrollment as any).nextSendAt && enrollment.status === "active" && (
            <p className="text-xs text-muted-foreground">
              Next email: <span className="font-medium text-slate-700">{format(new Date((enrollment as any).nextSendAt), "MMM d, h:mm a")}</span>
              {new Date((enrollment as any).nextSendAt) <= new Date() ? " (due now)" : ""}
            </p>
          )}
          {enrollment.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2"
              disabled={unenroll.isPending}
              onClick={() => unenroll.mutate({ id: leadId }, {
                onSuccess: () => { invalidate(); toast({ title: "Unenrolled from drip sequence" }); },
                onError: () => toast({ title: "Failed to unenroll", variant: "destructive" }),
              })}
            >
              Unenroll
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedSeq}
            onChange={(e) => setSelectedSeq(e.target.value)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white flex-1 min-w-0"
          >
            <option value="">Select sequence…</option>
            {(sequences ?? []).filter((s: any) => s.isActive).map((s: any) => (
              <option key={s.id} value={String(s.id)}>{s.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white px-3"
            disabled={!selectedSeq || enroll.isPending}
            onClick={() => enroll.mutate({ id: leadId, data: { sequenceId: parseInt(selectedSeq) } }, {
              onSuccess: () => { setSelectedSeq(""); invalidate(); toast({ title: "Enrolled in drip sequence" }); },
              onError: () => toast({ title: "Failed to enroll", variant: "destructive" }),
            })}
          >
            <Zap className="h-3 w-3 mr-1" /> Enroll
          </Button>
        </div>
      )}
    </div>
  );
}

const NOTES_TRUNCATE = 140;
function CallNoteBlock({ notes }: { notes: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = notes.length > NOTES_TRUNCATE;
  const shown = !isLong || expanded ? notes : notes.slice(0, NOTES_TRUNCATE) + "…";
  return (
    <div className="mt-1 text-xs text-slate-600 bg-white/60 rounded px-2 py-1 border border-slate-100 italic space-y-0.5">
      <p className="whitespace-pre-wrap break-words">{shown}</p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[#1F4E79] font-medium not-italic hover:underline text-[11px]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// Communications Tab
function LeadCommunications({ leadId, leadPhone, leadEmail }: { leadId: number; leadPhone?: string | null; leadEmail?: string | null }) {
  const { dial } = useContext(SoftphoneContext);
  const { data: comms, isLoading: commsLoading } = useListCommunications(leadId, { query: { queryKey: getListCommunicationsQueryKey(leadId) } });
  const { data: emails, isLoading: emailsLoading } = useListLeadEmails(leadId, { query: { queryKey: getListLeadEmailsQueryKey(leadId) } });
  const { data: templates } = useListEmailTemplates();
  const sendSms = useSendSms();
  const sendEmail = useSendEmail();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const previewEmailTemplate = usePreviewEmailTemplate();
  const generateDraft = useGenerateAiDraft();
  const [smsBody, setSmsBody] = useState("");
  const [activeCompose, setActiveCompose] = useState<"sms" | "email">("sms");
  const [emailMode, setEmailMode] = useState<"template" | "freeform">("template");
  const [emailTemplateId, setEmailTemplateId] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");
  const [emailPreview, setEmailPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [draftInstruction, setDraftInstruction] = useState("");
  const [draftPopoverOpen, setDraftPopoverOpen] = useState<"sms" | "email" | null>(null);

  const handleGenerateDraft = (channel: "sms" | "email") => {
    generateDraft.mutate(
      { id: leadId, data: { channel: channel === "sms" ? AiDraftRequestChannel.sms : AiDraftRequestChannel.email, instruction: draftInstruction.trim() || undefined } },
      {
        onSuccess: (data: any) => {
          if (channel === "sms") {
            setSmsBody(data.body);
          } else {
            setEmailMode("freeform");
            setEmailSubject(data.subject ?? "");
            setEmailBodyHtml(data.body);
            setEmailPreview(null);
            setShowPreview(false);
          }
          setDraftInstruction("");
          setDraftPopoverOpen(null);
          toast({ title: "AI draft generated", description: "Review before sending." });
        },
        onError: () => toast({ title: "Error", description: "Failed to generate AI draft.", variant: "destructive" }),
      }
    );
  };

  const handlePreviewTemplate = () => {
    if (!emailTemplateId) return;
    previewEmailTemplate.mutate(
      { id: parseInt(emailTemplateId), data: { leadId } },
      {
        onSuccess: (data: any) => { setEmailPreview(data); setShowPreview(true); },
        onError: () => { setEmailPreview(null); setShowPreview(false); },
      }
    );
  };

  const insertVar = (v: string) => setEmailBodyHtml((p: string) => p + v);

  const handleSendSms = () => {
    if (!smsBody.trim()) return;
    sendSms.mutate({ id: leadId, data: { body: smsBody.trim() } }, {
      onSuccess: () => {
        setSmsBody("");
        toast({ title: "SMS Sent" });
        queryClient.invalidateQueries({ queryKey: getListCommunicationsQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: (err: any) => {
        toast({ title: "Failed to send SMS", description: err?.message ?? "Twilio may not be configured.", variant: "destructive" });
      },
    });
  };

  const handleSendEmail = () => {
    const isTemplate = emailMode === "template";
    if (isTemplate && !emailTemplateId) return;
    if (!isTemplate && (!emailSubject.trim() || !emailBodyHtml.trim())) return;

    const payload = isTemplate
      ? { leadId, templateId: parseInt(emailTemplateId) }
      : { leadId, subject: emailSubject.trim(), bodyHtml: emailBodyHtml.trim() };

    sendEmail.mutate({ data: payload }, {
      onSuccess: () => {
        setEmailTemplateId("");
        setEmailSubject("");
        setEmailBodyHtml("");
        setEmailPreview(null);
        setShowPreview(false);
        toast({ title: "Email Sent" });
        queryClient.invalidateQueries({ queryKey: getListLeadEmailsQueryKey(leadId) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
      },
      onError: (err: any) => {
        const msg = (err as any)?.response?.data?.error ?? err?.message ?? "Send failed";
        toast({ title: "Failed to send email", description: msg, variant: "destructive" });
      },
    });
  };

  if (commsLoading || emailsLoading) return <div className="mt-4 space-y-3"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>;

  const hasNoEmail = !leadEmail;

  return (
    <div className="space-y-4 mt-4">
      {/* Call button */}
      {leadPhone && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <Phone className="h-4 w-4 text-blue-700" />
          <span className="text-sm font-medium text-blue-900 font-mono">{leadPhone}</span>
          <Button
            size="sm"
            className="ml-auto bg-green-600 hover:bg-green-700 text-white h-8 text-xs"
            onClick={() => dial(leadPhone, { autoCall: true, leadId })}
          >
            <PhoneCall className="h-3 w-3 mr-1" /> Call
          </Button>
        </div>
      )}

      {/* Thread — calls + SMS */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
        {!comms || comms.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg text-sm">
            No calls or SMS yet.
          </div>
        ) : (
          comms.map((c) => {
            const isOutbound = c.direction === "outbound";
            const isCall = c.type === "call";
            return (
              <div
                key={c.id}
                className={`flex gap-3 rounded-xl p-3 border text-sm ${isOutbound ? "bg-blue-50 border-blue-100" : "bg-slate-50 border-slate-200"}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {isOutbound
                    ? <ArrowUpRight className="h-4 w-4 text-blue-600" />
                    : <ArrowDownLeft className="h-4 w-4 text-slate-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium capitalize">{c.type}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{c.direction}</Badge>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{c.status}</Badge>
                    {isCall && c.durationSeconds != null && (
                      <span className="text-xs text-muted-foreground">{Math.floor(c.durationSeconds / 60)}m {c.durationSeconds % 60}s</span>
                    )}
                    {isCall && (c as any).callOutcome && (
                      <Badge
                        className={`text-[10px] h-4 px-1.5 capitalize ${
                          (c as any).callOutcome === "connected"
                            ? "bg-green-100 text-green-800 border-green-200"
                            : (c as any).callOutcome === "voicemail"
                            ? "bg-blue-100 text-blue-800 border-blue-200"
                            : (c as any).callOutcome === "no_answer" || (c as any).callOutcome === "busy"
                            ? "bg-amber-100 text-amber-800 border-amber-200"
                            : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}
                        variant="outline"
                      >
                        {((c as any).callOutcome as string).replace(/_/g, " ")}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(c.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                  {c.body && <p className="mt-1 text-sm text-slate-700 break-words">{c.body}</p>}
                  {isCall && (c as any).callNotes && (
                    <CallNoteBlock notes={(c as any).callNotes} />
                  )}
                  {c.recordingUrl && <audio controls className="mt-2 w-full h-8" src={c.recordingUrl} />}
                  {c.user && <p className="mt-1 text-xs text-muted-foreground">via {c.user.name ?? c.user.email}</p>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Email thread */}
      {emails && emails.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MailCheck className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Emails</span>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {emails.map((e: any) => (
              <div key={e.id} className="flex gap-3 rounded-xl p-3 border bg-purple-50 border-purple-100 text-sm">
                <MailOpen className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate max-w-[180px]">{e.subject}</span>
                    <EmailStatusBadge status={e.status} />
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(e.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">To: {e.toEmail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compose toggle */}
      <div className="border-t pt-3">
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => setActiveCompose("sms")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeCompose === "sms" ? "bg-[#1F4E79] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            <MessageSquare className="h-3 w-3" /> SMS
          </button>
          <button
            onClick={() => setActiveCompose("email")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${activeCompose === "email" ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"} ${hasNoEmail ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={hasNoEmail}
            title={hasNoEmail ? "Lead has no email address" : undefined}
          >
            <Mail className="h-3 w-3" /> Email
          </button>
        </div>

        {activeCompose === "sms" ? (
          <>
            <div className="flex justify-end">
              <Popover open={draftPopoverOpen === "sms"} onOpenChange={(o) => setDraftPopoverOpen(o ? "sms" : null)}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-[#1F4E79]/30 text-[#1F4E79]">
                    <Sparkles className="h-3 w-3" /> Draft with AI
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 space-y-2">
                  <p className="text-xs text-muted-foreground">Optional instruction to guide the draft (e.g. "follow up after missed call")</p>
                  <Textarea
                    value={draftInstruction}
                    onChange={(e) => setDraftInstruction(e.target.value)}
                    placeholder="Instruction (optional)…"
                    className="min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    size="sm"
                    onClick={() => handleGenerateDraft("sms")}
                    disabled={generateDraft.isPending}
                    className="w-full bg-[#1F4E79] hover:bg-[#163a5f] text-white text-xs"
                  >
                    {generateDraft.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                    Generate Draft
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex gap-2">
              <Textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder="Type an SMS message…"
                className="min-h-[64px] text-sm resize-none flex-1"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendSms(); }}
              />
              <Button onClick={handleSendSms} disabled={!smsBody.trim() || sendSms.isPending} className="self-end bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                <MessageSquare className="h-4 w-4 mr-1" /> Send
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to send</p>
          </>
        ) : (
          <div className="space-y-2">
            {/* Template / Custom toggle */}
            <div className="flex gap-1">
              <button
                onClick={() => { setEmailMode("template"); setEmailPreview(null); setShowPreview(false); }}
                className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${emailMode === "template" ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                From Template
              </button>
              <button
                onClick={() => { setEmailMode("freeform"); setEmailPreview(null); setShowPreview(false); }}
                className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${emailMode === "freeform" ? "bg-purple-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                Custom
              </button>
            </div>

            {emailMode === "template" ? (
              <>
                <div className="flex gap-2">
                  <select
                    value={emailTemplateId}
                    onChange={(e) => { setEmailTemplateId(e.target.value); setEmailPreview(null); setShowPreview(false); }}
                    className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="">Select an email template…</option>
                    {(templates ?? []).filter((t: any) => t.isActive).map((t: any) => (
                      <option key={t.id} value={String(t.id)}>{t.name}</option>
                    ))}
                  </select>
                  {emailTemplateId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handlePreviewTemplate}
                      disabled={previewEmailTemplate.isPending}
                      className="text-xs shrink-0"
                    >
                      Preview
                    </Button>
                  )}
                </div>
                {showPreview && emailPreview && (
                  <div className="border rounded-md p-3 bg-slate-50 text-xs space-y-1">
                    <div className="font-semibold text-slate-700">Subject: {emailPreview.subject}</div>
                    <div
                      className="text-slate-600 prose prose-sm max-h-[120px] overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: emailPreview.bodyHtml }}
                    />
                    <button onClick={() => setShowPreview(false)} className="text-purple-600 hover:underline text-[10px] mt-1">Hide preview</button>
                  </div>
                )}
                <Button
                  onClick={handleSendEmail}
                  disabled={!emailTemplateId || sendEmail.isPending}
                  className="bg-purple-600 hover:bg-purple-700 text-white w-full"
                >
                  <Mail className="h-4 w-4 mr-1.5" /> Send Email
                </Button>
              </>
            ) : (
              <>
                <div className="flex justify-end">
                  <Popover open={draftPopoverOpen === "email"} onOpenChange={(o) => setDraftPopoverOpen(o ? "email" : null)}>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-purple-300 text-purple-700">
                        <Sparkles className="h-3 w-3" /> Draft with AI
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 space-y-2">
                      <p className="text-xs text-muted-foreground">Optional instruction to guide the draft (e.g. "ask for updated bank statements")</p>
                      <Textarea
                        value={draftInstruction}
                        onChange={(e) => setDraftInstruction(e.target.value)}
                        placeholder="Instruction (optional)…"
                        className="min-h-[60px] text-sm resize-none"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleGenerateDraft("email")}
                        disabled={generateDraft.isPending}
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs"
                      >
                        {generateDraft.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                        Generate Draft
                      </Button>
                    </PopoverContent>
                  </Popover>
                </div>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject…"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                />
                <RichTextEditor
                  value={emailBodyHtml}
                  onChange={setEmailBodyHtml}
                  placeholder="Compose your email…"
                  variables={["{{lead_first_name}}", "{{lead_company}}", "{{rep_name}}", "{{rep_email}}"]}
                  minHeight="100px"
                />
                <Button
                  onClick={handleSendEmail}
                  disabled={!emailSubject.trim() || !emailBodyHtml.trim() || sendEmail.isPending}
                  className="bg-purple-600 hover:bg-purple-700 text-white w-full"
                >
                  <Mail className="h-4 w-4 mr-1.5" /> Send Email
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Drip status */}
      <LeadDripStatus leadId={leadId} />
    </div>
  );
}

// Edit Form Component
const editFormSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  companyName: z.string().optional().or(z.literal("")),
  applicationType: z.nativeEnum(LeadUpdateApplicationType).optional(),
});

function EditLeadDialog({ lead }: { lead: any }) {
  const [open, setOpen] = useState(false);
  const updateLead = useUpdateLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof editFormSchema>>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      firstName: lead.firstName || "",
      lastName: lead.lastName || "",
      email: lead.email || "",
      phone: lead.phone || "",
      companyName: lead.companyName || "",
      applicationType: lead.applicationType as LeadUpdateApplicationType,
    },
  });

  const onSubmit = (values: z.infer<typeof editFormSchema>) => {
    updateLead.mutate({ id: lead.id, data: values }, {
      onSuccess: () => {
        toast({ title: "Lead Updated" });
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(lead.id) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(lead.id) });
      },
      onError: () => toast({ title: "Error", description: "Failed to update lead.", variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit Details</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Lead</DialogTitle>
          <DialogDescription>Update lead information here.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="firstName" render={({ field }) => (
                <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="lastName" render={({ field }) => (
                <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input type="tel" {...field} /></FormControl></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="companyName" render={({ field }) => (
              <FormItem><FormLabel>Company Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
            )} />
            <FormField control={form.control} name="applicationType" render={({ field }) => (
              <FormItem>
                <FormLabel>Financing Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={LeadUpdateApplicationType.working_capital}>Working Capital</SelectItem>
                    <SelectItem value={LeadUpdateApplicationType.equipment}>Equipment Financing</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateLead.isPending}>Save Changes</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// Lender Match Tab
function LeadLenderMatch({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const runMatch = useRunLenderMatch();
  const { data: matches, isLoading: matchesLoading } = useGetLenderMatches(leadId);
  const { data: submissions } = useGetLeadSubmissions(leadId);
  const createSub = useCreateLeadSubmission();
  const updateSub = useUpdateSubmission();

  // Confirmation modal state
  const [pendingLender, setPendingLender] = useState<{ id: number; name: string } | null>(null);
  // Expandable criteria state — track which match cards are expanded
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

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
      onError: () => toast({ title: "Match failed", variant: "destructive" }),
    });
  };

  const confirmSubmit = () => {
    if (!pendingLender) return;
    createSub.mutate({ id: leadId, data: { lender_id: pendingLender.id } as any }, {
      onSuccess: () => {
        toast({ title: `Submitted to ${pendingLender.name}` });
        queryClient.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
        setPendingLender(null);
      },
      onError: () => {
        toast({ title: "Submission failed", variant: "destructive" });
        setPendingLender(null);
      },
    });
  };

  const handleStatusUpdate = (subId: number, status: string) => {
    updateSub.mutate({ id: subId, data: { status } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
      },
    });
  };

  const submittedLenderIds = new Set((submissions ?? []).map((s: any) => s.lenderId));

  const statusColor: Record<string, string> = {
    submitted: "bg-blue-50 text-blue-700 border-blue-200",
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-green-50 text-green-700 border-green-200",
    declined: "bg-red-50 text-red-700 border-red-200",
    withdrawn: "bg-slate-50 text-slate-500 border-slate-200",
  };

  return (
    <div className="space-y-5 mt-4">
      {/* Confirm submission dialog */}
      <Dialog open={!!pendingLender} onOpenChange={(open) => { if (!open) setPendingLender(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Submission</DialogTitle>
            <DialogDescription>
              You are about to submit this deal to <strong>{pendingLender?.name}</strong>. This will notify the lender and create a submission record. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setPendingLender(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white"
              disabled={createSub.isPending}
              onClick={confirmSubmit}
            >
              {createSub.isPending ? "Submitting…" : "Yes, Submit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run Match Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Lender Matching</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Run the engine to find the best lenders for this deal</p>
        </div>
        <Button
          size="sm"
          onClick={handleRunMatch}
          disabled={runMatch.isPending}
          className="bg-[#1F4E79] hover:bg-[#163a5f] text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${runMatch.isPending ? "animate-spin" : ""}`} />
          {runMatch.isPending ? "Matching…" : "Run Match"}
        </Button>
      </div>

      {/* Match Results */}
      {matchesLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : !matches || matches.length === 0 ? (
        <div className="text-center py-8 border border-dashed rounded-xl text-muted-foreground text-sm">
          No matches yet. Click "Run Match" to find lenders.
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map((m: any, idx: number) => {
            const isSubmitted = submittedLenderIds.has(m.lenderId);
            const passedCount = (m.criteriaBreakdown ?? []).filter((c: any) => c.passed && !c.skipped).length;
            const totalCount = (m.criteriaBreakdown ?? []).filter((c: any) => !c.skipped).length;
            const isExpanded = expandedIds.has(m.id);
            const lenderName = m.lender?.name ?? `Lender #${m.lenderId}`;
            return (
              <div key={m.id} className={`rounded-xl border p-3 space-y-2 ${idx === 0 ? "border-[#1F4E79]/30 bg-blue-50/30" : "bg-white"}`}>
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
                      <div className="font-medium text-sm text-slate-800 truncate">{lenderName}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className={`h-2.5 w-2.5 ${i < Math.round((m.lender?.priorityWeight ?? 5) / 2) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                        ))}
                        <span className="text-[10px] text-muted-foreground ml-1">{m.matchScore}% match · {passedCount}/{totalCount} criteria</span>
                      </div>
                    </div>
                  </button>
                  {!isSubmitted ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-[#1F4E79] text-[#1F4E79] hover:bg-[#1F4E79] hover:text-white shrink-0 ml-2"
                      onClick={() => setPendingLender({ id: m.lenderId, name: lenderName })}
                    >
                      <Send className="h-3 w-3 mr-1" /> Submit
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 shrink-0 ml-2">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> Submitted
                    </Badge>
                  )}
                </div>

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
                <p className="text-xs text-muted-foreground">{format(new Date(s.submittedAt), "MMM d, h:mm a")}</p>
                {s.responseNotes && (
                  <p className="text-xs text-slate-600 mt-0.5 italic truncate" title={s.responseNotes}>
                    {s.responseNotes}
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
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="declined">Declined</option>
                    <option value="withdrawn">Withdrawn</option>
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

// Client-side template rendering (mirrors server renderTemplate logic)
function applyFieldValues(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

// Marketing / Flyer Tab
function LeadMarketing({ leadId, lead }: { leadId: number; lead: any }) {
  const { toast } = useToast();
  const { data: templates = [], isLoading: templatesLoading } = useListFlyerTemplates({ activeOnly: true });
  const generateFlyer = useGenerateFlyer();
  const emailFlyer = useEmailFlyer();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [lastFlyerId, setLastFlyerId] = useState<number | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Sort templates: matching program type first, then general, then rest
  const leadProgramType = lead.applicationType as string | null;
  const sortedTemplates = [...(templates as any[])].sort((a: any, b: any) => {
    const aMatch = a.programType === leadProgramType ? 0 : a.programType === "general" ? 1 : 2;
    const bMatch = b.programType === leadProgramType ? 0 : b.programType === "general" ? 1 : 2;
    return aMatch - bMatch;
  });

  const selectedTemplate = sortedTemplates.find((t: any) => String(t.id) === selectedTemplateId);

  // Live preview HTML — recomputed as field values change
  const previewHtml = selectedTemplate
    ? applyFieldValues(selectedTemplate.htmlTemplate ?? "", fieldValues)
    : "";

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    setLastFlyerId(null);
    setEmailSent(false);
    const tmpl = sortedTemplates.find((t: any) => String(t.id) === id);
    if (tmpl) {
      const defaults: Record<string, string> = {};
      for (const f of tmpl.variableFields ?? []) {
        if (f.key === "rep_name" && lead.assignedRep?.name) defaults[f.key] = lead.assignedRep.name;
        else if (f.key === "rep_email" && lead.assignedRep?.email) defaults[f.key] = lead.assignedRep.email;
        else if (f.key === "rep_phone" && lead.assignedRep?.phone) defaults[f.key] = lead.assignedRep.phone;
        else defaults[f.key] = f.defaultValue ?? "";
      }
      setFieldValues(defaults);
    }
  };

  const handleGenerate = () => {
    if (!selectedTemplateId) return;
    generateFlyer.mutate(
      { data: { templateId: Number(selectedTemplateId), fieldValues, leadId } },
      {
        onSuccess: (data: any) => {
          setLastFlyerId(data.flyerId);
          setEmailSent(false);
          // Auto-open download immediately
          window.open(getDownloadFlyerUrl(data.flyerId), "_blank");
          toast({ title: "Flyer generated!", description: "PDF download started. You can also email it below." });
        },
        onError: () => toast({ title: "Generation failed", variant: "destructive" }),
      }
    );
  };

  const handleEmail = () => {
    if (!lastFlyerId || !lead.email) return;
    emailFlyer.mutate(
      { id: lastFlyerId, data: { leadId } },
      {
        onSuccess: () => {
          setEmailSent(true);
          toast({ title: "Flyer emailed!", description: `Sent to ${lead.email}` });
        },
        onError: () => toast({ title: "Email failed", description: "Check SendGrid configuration.", variant: "destructive" }),
      }
    );
  };

  if (templatesLoading) {
    return <div className="mt-4 space-y-3"><div className="h-16 bg-muted animate-pulse rounded-lg" /><div className="h-16 bg-muted animate-pulse rounded-lg" /></div>;
  }

  if (sortedTemplates.length === 0) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
        <Megaphone className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="font-medium text-muted-foreground">No flyer templates available</p>
        <p className="text-sm text-muted-foreground mt-1">Ask an admin to create templates in the Flyer Templates section.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4 text-[#1F4E79]" /> Generate Marketing Flyer</CardTitle>
          <CardDescription className="text-xs">
            Select a template, customize the fields, preview live, then export PDF to download or email.
            {leadProgramType && <span className="ml-1 text-[#1F4E79] font-medium">(Best-match templates shown first.)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Flyer Template</Label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose a template..." /></SelectTrigger>
              <SelectContent>
                {sortedTemplates.map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                    {t.programType === leadProgramType && <span className="ml-1.5 text-xs text-[#1F4E79] font-medium">★</span>}
                    {t.programType !== "general" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({t.programType === "working_capital" ? "Working Capital" : "Equipment"})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTemplate && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customize Fields</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(selectedTemplate.variableFields ?? []).map((f: any) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    {f.type === "select" && Array.isArray(f.options) && f.options.length > 0 ? (
                      <Select
                        value={fieldValues[f.key] ?? f.defaultValue ?? ""}
                        onValueChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {f.options.map((opt: string) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={f.type === "number" ? "number" : "text"}
                        className="h-8 text-xs"
                        value={fieldValues[f.key] ?? f.defaultValue ?? ""}
                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.defaultValue}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Preview Panel */}
          {selectedTemplate && (
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Preview</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </Button>
              </div>
              {showPreview && (
                <div className="border rounded-lg overflow-hidden shadow-sm bg-white">
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="w-full"
                    style={{ height: "520px", border: "none" }}
                    title="Flyer Preview"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white h-9 text-sm"
              onClick={handleGenerate}
              disabled={!selectedTemplateId || generateFlyer.isPending}
            >
              {generateFlyer.isPending
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating...</>
                : <><FileDown className="h-3.5 w-3.5 mr-1.5" /> Export PDF</>}
            </Button>

            {lastFlyerId && lead.email && (
              <Button
                variant="outline"
                className="h-9 text-sm"
                onClick={handleEmail}
                disabled={emailFlyer.isPending || emailSent}
              >
                {emailSent
                  ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600" /> Emailed</>
                  : emailFlyer.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending...</>
                    : <><Send className="h-3.5 w-3.5 mr-1.5" /> Email to Lead</>}
              </Button>
            )}
            {lastFlyerId && !lead.email && (
              <p className="text-xs text-muted-foreground self-center">(No email on file — cannot email)</p>
            )}
          </div>

          {lastFlyerId && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Flyer exported and saved to this lead's documents. Download opened automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LeadApplication({ leadId }: { leadId: number }) {
  const { data, isLoading, error } = useGetLeadApplication(leadId);
  const { toast } = useToast();

  const applyUrl = `${window.location.origin}${import.meta.env.BASE_URL}apply`;

  const copyLink = () => {
    navigator.clipboard.writeText(applyUrl).then(() => {
      toast({ title: "Link copied!", description: "Application link copied to clipboard." });
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#1F4E79]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6 space-y-3">
              <ClipboardList className="h-10 w-10 text-gray-300 mx-auto" />
              <p className="text-gray-500 font-medium">No application on file</p>
              <p className="text-sm text-gray-400">Share the application link so the lead can submit their information.</p>
              <div className="flex items-center justify-center gap-2 mt-4">
                <code className="text-xs bg-slate-100 px-3 py-2 rounded-lg text-[#1F4E79] font-mono break-all">{applyUrl}</code>
                <Button variant="outline" size="sm" onClick={copyLink} className="flex items-center gap-1.5 flex-shrink-0">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const app = data;
  const fmt = (v: number | null | undefined, prefix = "$") =>
    v != null ? `${prefix}${v.toLocaleString()}` : "—";

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[#1F4E79]/10 flex items-center justify-center">
            <ClipboardList className="h-4 w-4 text-[#1F4E79]" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Application on File</p>
            <p className="text-xs text-gray-400">Submitted {app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize bg-blue-50 border-blue-200 text-blue-700">
            {app.type.replace("_", " ")}
          </Badge>
          {app.signedDocumentUrl && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 text-xs h-7"
              onClick={() => window.open(app.signedDocumentUrl!, "_blank")}
            >
              <FileDown className="h-3.5 w-3.5" /> Download
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Business Info */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Business Name</dt><dd className="font-medium">{app.businessName}</dd></div>
              {app.dba && <div className="flex justify-between"><dt className="text-gray-500">DBA</dt><dd className="font-medium">{app.dba}</dd></div>}
              {app.ein && <div className="flex justify-between"><dt className="text-gray-500">EIN</dt><dd className="font-medium">{app.ein}</dd></div>}
              {app.industry && <div className="flex justify-between"><dt className="text-gray-500">Industry</dt><dd className="font-medium">{app.industry}</dd></div>}
              {app.timeInBusinessMonths != null && <div className="flex justify-between"><dt className="text-gray-500">Time in Business</dt><dd className="font-medium">{Math.round(app.timeInBusinessMonths / 12)} yr(s)</dd></div>}
              {(app.businessCity || app.businessState) && (
                <div className="flex justify-between"><dt className="text-gray-500">Location</dt><dd className="font-medium">{[app.businessCity, app.businessState, app.businessZip].filter(Boolean).join(", ")}</dd></div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Owner Info */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Owner Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd className="font-medium">{app.ownerFirstName} {app.ownerLastName}</dd></div>
              {app.ownerSsnMasked && (
                <div className="flex justify-between items-center">
                  <dt className="text-gray-500 flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-green-500" /> SSN</dt>
                  <dd className="font-mono font-medium">{app.ownerSsnMasked}</dd>
                </div>
              )}
              {app.ownerDob && <div className="flex justify-between"><dt className="text-gray-500">Date of Birth</dt><dd className="font-medium">{new Date(app.ownerDob).toLocaleDateString()}</dd></div>}
              {app.ownershipPct != null && <div className="flex justify-between"><dt className="text-gray-500">Ownership</dt><dd className="font-medium">{app.ownershipPct}%</dd></div>}
              {(app.ownerHomeCity || app.ownerHomeState) && (
                <div className="flex justify-between"><dt className="text-gray-500">Home Location</dt><dd className="font-medium">{[app.ownerHomeCity, app.ownerHomeState].filter(Boolean).join(", ")}</dd></div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Financing Details */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Financing Request</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Type</dt><dd className="font-medium capitalize">{app.type.replace("_", " ")}</dd></div>
              {app.monthlyRevenueStated != null && <div className="flex justify-between"><dt className="text-gray-500">Monthly Revenue</dt><dd className="font-medium">{fmt(app.monthlyRevenueStated)}</dd></div>}
              {app.requestedAmount != null && <div className="flex justify-between"><dt className="text-gray-500">Requested Amount</dt><dd className="font-medium text-[#1F4E79]">{fmt(app.requestedAmount)}</dd></div>}
              {app.useOfFunds && <div className="flex justify-between gap-4"><dt className="text-gray-500 flex-shrink-0">Use of Funds</dt><dd className="font-medium text-right">{app.useOfFunds}</dd></div>}
              {app.type === "equipment" && (
                <>
                  {app.equipmentDescription && <div className="flex justify-between gap-4"><dt className="text-gray-500 flex-shrink-0">Equipment</dt><dd className="font-medium text-right">{app.equipmentDescription}</dd></div>}
                  {app.vendorName && <div className="flex justify-between"><dt className="text-gray-500">Vendor</dt><dd className="font-medium">{app.vendorName}</dd></div>}
                  {app.vendorQuoteAmount && <div className="flex justify-between"><dt className="text-gray-500">Quote</dt><dd className="font-medium">{fmt(parseFloat(app.vendorQuoteAmount))}</dd></div>}
                  {app.equipmentCondition && <div className="flex justify-between"><dt className="text-gray-500">Condition</dt><dd className="font-medium capitalize">{app.equipmentCondition}</dd></div>}
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Consent + Signature */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Consents & Signature</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              {app.consentCreditPull
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
              <span className={app.consentCreditPull ? "text-gray-700" : "text-gray-400"}>Credit pull authorized</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {app.consentTerms
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
              <span className={app.consentTerms ? "text-gray-700" : "text-gray-400"}>Terms & Privacy agreed</span>
            </div>
            <div className="flex items-center gap-2 text-xs mt-2">
              {app.signatureData === "[signature on file]"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
              <span className={app.signatureData ? "text-gray-700" : "text-gray-400"}>
                {app.signatureData ? "Electronic signature on file" : "No signature"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Share link */}
      <div className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-3">
        <TrendingUp className="h-4 w-4 text-[#1F4E79] flex-shrink-0" />
        <span className="text-xs text-gray-500 flex-1">Share application link:</span>
        <code className="text-xs font-mono text-[#1F4E79] truncate max-w-[200px]">{applyUrl}</code>
        <Button variant="outline" size="sm" onClick={copyLink} className="flex items-center gap-1 flex-shrink-0 h-7 text-xs">
          <Copy className="h-3 w-3" /> Copy
        </Button>
      </div>
    </div>
  );
}

// ─── Credit Score Gauge ───────────────────────────────────────────────────────
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
function LeadCredit({ leadId }: { leadId: number }) {
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
                  className="bg-[#1F4E79] hover:bg-[#163a5f] gap-2 min-w-40"
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
                <span>pulled by {(displayPull.pulledBy as { name?: string } | null)?.name ?? "Unknown"}</span>
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
                    <td className="py-2.5 px-4">{(p.pulledBy as { name?: string } | null)?.name ?? "—"}</td>
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

function LeadFinancials({ leadId }: { leadId: number }) {
  const { data, isLoading } = useGetLeadFinancials(leadId);

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#1F4E79]" />
      </div>
    );
  }

  if (!data || data.months.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6 space-y-2">
              <BarChart3 className="h-10 w-10 text-gray-300 mx-auto" />
              <p className="text-gray-500 font-medium">No bank statement data</p>
              <p className="text-sm text-gray-400">Bank statement extractions will appear here once the applicant submits their application with PDF statements.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { months, summary } = data;
  const fmt = (v: number | null | undefined) => v != null ? `$${Math.round(v).toLocaleString()}` : "—";

  // Health indicator: green = 0 NSF/month, yellow = 1–4, red = >4
  const healthScore = summary
    ? summary.avgNsfsPerMonth === 0 ? "green"
      : summary.avgNsfsPerMonth <= 4 ? "yellow"
      : "red"
    : null;

  const healthLabel = { green: "Strong", yellow: "Fair", red: "High Risk" } as const;
  const healthColors = {
    green: "bg-green-100 text-green-700 border-green-200",
    yellow: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
  } as const;

  return (
    <div className="p-4 space-y-4">
      {/* Health indicator */}
      {healthScore && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${healthColors[healthScore]}`}>
          <div className={`h-3 w-3 rounded-full flex-shrink-0 ${healthScore === "green" ? "bg-green-500" : healthScore === "yellow" ? "bg-amber-500" : "bg-red-500"}`} />
          <div>
            <p className="font-semibold text-sm">{healthLabel[healthScore]} — {healthScore === "green" ? "No NSF activity detected" : healthScore === "yellow" ? `Avg ${summary!.avgNsfsPerMonth.toFixed(1)} NSF/month` : `High NSF rate: ${summary!.avgNsfsPerMonth.toFixed(1)}/month`}</p>
            <p className="text-xs opacity-75">Based on {summary!.monthsAnalyzed} month(s) of statements · {summary!.positionsDetected} existing position(s) detected</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Avg Monthly Deposits</p>
              <p className="text-lg font-bold text-[#1F4E79]">{fmt(summary.avgMonthlyDeposits)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Avg Daily Balance</p>
              <p className="text-lg font-bold text-gray-900">{fmt(summary.avgDailyBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Months Analyzed</p>
              <p className="text-lg font-bold text-gray-900">{summary.monthsAnalyzed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Total NSFs</p>
              <p className={`text-lg font-bold ${summary.totalNsfs > 3 ? "text-red-600" : "text-gray-900"}`}>{summary.totalNsfs}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly breakdown table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-gray-700">Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Period</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Total Deposits</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Avg Daily Bal</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">NSFs</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Neg. Days</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-gray-700">
                      {m.statementYear && m.statementMonth
                        ? `${MONTH_NAMES[(m.statementMonth - 1) % 12]} ${m.statementYear}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-[#1F4E79] font-medium">{fmt(m.totalDeposits)}</td>
                    <td className="px-4 py-2 text-right">{fmt(m.averageDailyBalance)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${m.nsfCount > 1 ? "text-red-600" : "text-gray-700"}`}>{m.nsfCount}</td>
                    <td className={`px-4 py-2 text-right ${m.negativeBalanceDays > 3 ? "text-amber-600" : "text-gray-700"}`}>{m.negativeBalanceDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Existing positions */}
      {months.some((m) => m.existingPositions.length > 0) && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Existing Positions Detected</CardTitle>
            <CardDescription className="text-xs">MCA or loan payments found in bank statements</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {months.flatMap((m) => m.existingPositions).map((p, i) => (
                <div key={i} className="flex justify-between items-center text-xs bg-amber-50 rounded-lg px-3 py-2">
                  <span className="text-gray-700">{p.description}</span>
                  <div className="text-right">
                    <span className="font-medium text-amber-700">{fmt(p.amount)}</span>
                    <span className="text-gray-400 ml-1">/ {p.frequency}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LeadConsent({ leadId }: { leadId: number }) {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [forceScrubbing, setForceScrubbing] = useState(false);

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
                label={status.applicationConsent.consentTerms ? "Terms & conditions consent on file" : "Terms consent not on file"}
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

export default function LeadDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lead, isLoading } = useGetLead(id, { 
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) } 
  });

  const changeStatus = useChangeLeadStatus();
  const [fundedDialogOpen, setFundedDialogOpen] = useState(false);
  const [fundedAmountInput, setFundedAmountInput] = useState("");

  const submitStatusChange = (newStatus: string, fundedAmount?: number) => {
    changeStatus.mutate({ id, data: { status: newStatus as StatusChangeStatus, ...(fundedAmount !== undefined ? { fundedAmount } : {}) } }, {
      onSuccess: () => {
        toast({ title: "Status Updated", description: "Lead status has been changed." });
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(id) });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to change status.", variant: "destructive" });
      }
    });
  };

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "funded") {
      setFundedAmountInput(lead?.requestedAmount != null ? String(lead.requestedAmount) : "");
      setFundedDialogOpen(true);
      return;
    }
    submitStatusChange(newStatus);
  };

  const handleConfirmFunded = () => {
    const amount = parseInt(fundedAmountInput, 10);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Please enter a valid funded amount.", variant: "destructive" });
      return;
    }
    submitStatusChange("funded", amount);
    setFundedDialogOpen(false);
  };

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-10 w-[200px]" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!lead) {
    return <div className="p-8 flex items-center justify-center h-full text-muted-foreground">Lead not found</div>;
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50/50">
      {/* Header */}
      <div className="border-b bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="mb-3">
          <Link href="/leads" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Leads
          </Link>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 truncate">
              {lead.firstName} {lead.lastName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {lead.companyName && (
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-gray-400" />
                  {lead.companyName}
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a>
                </div>
              )}
              {lead.phone && (
                <PhoneLink phone={lead.phone} />
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <Select 
              value={lead.status} 
              onValueChange={handleStatusChange}
              disabled={changeStatus.isPending}
            >
              <SelectTrigger className="w-[180px] bg-white font-medium shadow-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_lead">New Lead</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="application_received">App Received</SelectItem>
                <SelectItem value="submitted_to_underwriting">In Underwriting</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="funded">Funded</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
              </SelectContent>
            </Select>
            <EditLeadDialog lead={lead} />
          </div>
        </div>
        </div>
      </div>

      <Dialog open={fundedDialogOpen} onOpenChange={setFundedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Lead as Funded</DialogTitle>
            <DialogDescription>
              Enter the funded amount for this deal to record it in revenue reporting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="funded-amount">Funded amount ($)</Label>
            <Input
              id="funded-amount"
              type="number"
              min={1}
              step={1}
              autoFocus
              value={fundedAmountInput}
              onChange={(e) => setFundedAmountInput(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFundedDialogOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#1F4E79] hover:bg-[#1F4E79]/90"
              onClick={handleConfirmFunded}
              disabled={changeStatus.isPending}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="p-8 max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Details */}
        <div className="space-y-6 lg:sticky lg:top-[160px]">
          <Card className="shadow-sm">
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> Deal Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-y-6">
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Financing Type</div>
                  <div className="font-medium capitalize text-sm">{lead.applicationType.replace('_', ' ')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Source</div>
                  <div className="font-medium capitalize text-sm">{lead.leadSource}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Assigned To</div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {lead.assignedRep ? (
                      <>
                        <div className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                          {lead.assignedRep.name?.charAt(0) || 'U'}
                        </div>
                        {lead.assignedRep.name}
                      </>
                    ) : 'Unassigned'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Created</div>
                  <div className="font-medium text-sm">{format(new Date(lead.createdAt), 'MMM d, yyyy')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="info" className="w-full">
            <div className="overflow-x-auto">
            <TabsList className="flex w-max min-w-full bg-white shadow-sm border p-1 gap-0.5 h-auto rounded-lg">
              <TabsTrigger value="info" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><User className="h-3.5 w-3.5 shrink-0"/> Info</TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileText className="h-3.5 w-3.5 shrink-0"/> Notes</TabsTrigger>
              <TabsTrigger value="tasks" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><CheckSquare className="h-3.5 w-3.5 shrink-0"/> Tasks</TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileIcon className="h-3.5 w-3.5 shrink-0"/> Docs</TabsTrigger>
              <TabsTrigger value="communications" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><MessageSquare className="h-3.5 w-3.5 shrink-0"/> Comms</TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Clock className="h-3.5 w-3.5 shrink-0"/> Activity</TabsTrigger>
              <TabsTrigger value="lenders" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Building2 className="h-3.5 w-3.5 shrink-0"/> Lenders</TabsTrigger>
              <TabsTrigger value="marketing" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Megaphone className="h-3.5 w-3.5 shrink-0"/> Marketing</TabsTrigger>
              <TabsTrigger value="application" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ClipboardList className="h-3.5 w-3.5 shrink-0"/> App</TabsTrigger>
              <TabsTrigger value="financials" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><BarChart3 className="h-3.5 w-3.5 shrink-0"/> Financials</TabsTrigger>
              <TabsTrigger value="credit" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ShieldCheck className="h-3.5 w-3.5 shrink-0"/> Credit</TabsTrigger>
              <TabsTrigger value="consent" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ListChecks className="h-3.5 w-3.5 shrink-0"/> Consent</TabsTrigger>
            </TabsList>
          </div>
            <TabsContent value="info" className="outline-none">
              <LeadInfo lead={lead} leadId={id} />
            </TabsContent>
            <TabsContent value="notes" className="outline-none">
              <LeadNotes leadId={id} />
            </TabsContent>
            <TabsContent value="tasks" className="outline-none">
              <LeadTasks leadId={id} />
            </TabsContent>
            <TabsContent value="documents" className="outline-none">
              <LeadDocuments leadId={id} />
            </TabsContent>
            <TabsContent value="communications" className="outline-none">
              <LeadCommunications leadId={id} leadPhone={lead.phone} leadEmail={lead.email} />
            </TabsContent>
            <TabsContent value="activity" className="outline-none">
              <LeadActivity leadId={id} />
            </TabsContent>
            <TabsContent value="lenders" className="outline-none">
              <LeadLenderMatch leadId={id} />
            </TabsContent>
            <TabsContent value="marketing" className="outline-none">
              <LeadMarketing leadId={id} lead={lead} />
            </TabsContent>
            <TabsContent value="application" className="outline-none">
              <LeadApplication leadId={id} />
            </TabsContent>
            <TabsContent value="financials" className="outline-none">
              <LeadFinancials leadId={id} />
            </TabsContent>
            <TabsContent value="credit" className="outline-none">
              <LeadCredit leadId={id} />
            </TabsContent>
            <TabsContent value="consent" className="outline-none">
              <LeadConsent leadId={id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
