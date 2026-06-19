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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Building2, User, Phone, Mail, FileText, CheckSquare, Clock, Download, UploadCloud, Plus, Calendar as CalendarIcon, File as FileIcon, MessageSquare, PhoneCall, PhoneIncoming, PhoneOutgoing, ArrowUpRight, ArrowDownLeft, MailCheck, Zap, MailOpen } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PhoneLink } from "@/components/phone-link";
import { SoftphoneContext } from "@/components/softphone-context";

const formatStatus = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

// Info Tab
function LeadInfo({ lead, leadId }: { lead: any; leadId: number }) {
  const { data: currentUser } = useGetMe();
  const { data: reps } = useListUsers({ role: "rep" });
  const assignLead = useAssignLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const canAssign = currentUser?.role === "manager" || currentUser?.role === "admin";

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

  return (
    <div className="mt-4 space-y-6">
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
  const [smsBody, setSmsBody] = useState("");
  const [activeCompose, setActiveCompose] = useState<"sms" | "email">("sms");
  const [emailMode, setEmailMode] = useState<"template" | "freeform">("template");
  const [emailTemplateId, setEmailTemplateId] = useState<string>("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");
  const [emailPreview, setEmailPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

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
            onClick={() => dial(leadPhone, { autoCall: true })}
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
                    <span className="text-xs text-muted-foreground ml-auto">{format(new Date(c.createdAt), "MMM d, h:mm a")}</span>
                  </div>
                  {c.body && <p className="mt-1 text-sm text-slate-700 break-words">{c.body}</p>}
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
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject…"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 bg-white"
                />
                <Textarea
                  value={emailBodyHtml}
                  onChange={(e) => setEmailBodyHtml(e.target.value)}
                  placeholder="Email body (HTML supported)…"
                  className="min-h-[80px] text-sm resize-none font-mono"
                />
                <div className="flex flex-wrap gap-1">
                  {["{{lead_first_name}}", "{{lead_company}}", "{{rep_name}}", "{{rep_email}}"].map((v) => (
                    <button
                      key={v}
                      onClick={() => insertVar(v)}
                      className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5 hover:bg-purple-100"
                    >
                      {v}
                    </button>
                  ))}
                </div>
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

export default function LeadDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lead, isLoading } = useGetLead(id, { 
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) } 
  });

  const changeStatus = useChangeLeadStatus();

  const handleStatusChange = (newStatus: string) => {
    changeStatus.mutate({ id, data: { status: newStatus as StatusChangeStatus } }, {
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

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-10 w-[200px]" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!lead) {
    return <div className="p-8 flex items-center justify-center h-full text-muted-foreground">Lead not found</div>;
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50/50">
      {/* Header */}
      <div className="border-b bg-white px-8 py-6 shadow-sm sticky top-0 z-10">
        <div className="mb-4">
          <Link href="/leads" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Leads
          </Link>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {lead.firstName} {lead.lastName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
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
            <TabsList className="grid w-full grid-cols-6 bg-white shadow-sm border p-1 h-12">
              <TabsTrigger value="info" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><User className="h-3.5 w-3.5"/> Info</TabsTrigger>
              <TabsTrigger value="notes" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><FileText className="h-3.5 w-3.5"/> Notes</TabsTrigger>
              <TabsTrigger value="tasks" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><CheckSquare className="h-3.5 w-3.5"/> Tasks</TabsTrigger>
              <TabsTrigger value="documents" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><FileIcon className="h-3.5 w-3.5"/> Docs</TabsTrigger>
              <TabsTrigger value="communications" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><MessageSquare className="h-3.5 w-3.5"/> Comms</TabsTrigger>
              <TabsTrigger value="activity" className="flex gap-1.5 data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 text-xs"><Clock className="h-3.5 w-3.5"/> Activity</TabsTrigger>
            </TabsList>
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
          </Tabs>
        </div>
      </div>
    </div>
  );
}
