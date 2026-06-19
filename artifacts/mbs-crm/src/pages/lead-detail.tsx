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
import { ArrowLeft, Building2, User, Phone, Mail, FileText, CheckSquare, Clock, Download, UploadCloud, Plus, Calendar as CalendarIcon, File as FileIcon, MessageSquare, PhoneCall, PhoneIncoming, PhoneOutgoing, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SoftphoneContext } from "@/components/softphone-context";

const formatStatus = (status: string) => status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

function ClickToCallPhone({ phone }: { phone: string }) {
  const { dial } = useContext(SoftphoneContext);
  return (
    <button
      onClick={() => dial(phone, { autoCall: true })}
      className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline transition-colors"
      title={`Call ${phone}`}
    >
      <Phone className="h-4 w-4 text-gray-400 flex-shrink-0" />
      <span>{phone}</span>
    </button>
  );
}

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
    { label: "Phone", value: lead.phone ? <ClickToCallPhone phone={lead.phone} /> : "—" },
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

// Communications Tab
function LeadCommunications({ leadId, leadPhone }: { leadId: number; leadPhone?: string | null }) {
  const { dial } = useContext(SoftphoneContext);
  const { data: comms, isLoading } = useListCommunications(leadId, { query: { queryKey: getListCommunicationsQueryKey(leadId) } });
  const sendSms = useSendSms();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [smsBody, setSmsBody] = useState("");

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

  if (isLoading) return <div className="mt-4 space-y-3"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>;

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

      {/* Thread */}
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {!comms || comms.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg text-sm">
            No communications yet.
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
                  {isCall ? (
                    isOutbound
                      ? <ArrowUpRight className="h-4 w-4 text-blue-600" />
                      : <ArrowDownLeft className="h-4 w-4 text-slate-600" />
                  ) : (
                    isOutbound
                      ? <ArrowUpRight className="h-4 w-4 text-blue-600" />
                      : <ArrowDownLeft className="h-4 w-4 text-slate-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium capitalize">{c.type}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {c.direction}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">
                      {c.status}
                    </Badge>
                    {isCall && c.durationSeconds != null && (
                      <span className="text-xs text-muted-foreground">
                        {Math.floor(c.durationSeconds / 60)}m {c.durationSeconds % 60}s
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {format(new Date(c.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  {c.body && (
                    <p className="mt-1 text-sm text-slate-700 break-words">{c.body}</p>
                  )}
                  {c.recordingUrl && (
                    <audio controls className="mt-2 w-full h-8" src={c.recordingUrl} />
                  )}
                  {c.user && (
                    <p className="mt-1 text-xs text-muted-foreground">via {c.user.name ?? c.user.email}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* SMS compose */}
      <div className="border-t pt-3">
        <div className="flex gap-2">
          <Textarea
            value={smsBody}
            onChange={(e) => setSmsBody(e.target.value)}
            placeholder="Type an SMS message…"
            className="min-h-[64px] text-sm resize-none flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendSms();
            }}
          />
          <Button
            onClick={handleSendSms}
            disabled={!smsBody.trim() || sendSms.isPending}
            className="self-end bg-[#1F4E79] hover:bg-[#163a5f] text-white"
          >
            <MessageSquare className="h-4 w-4 mr-1" /> Send
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to send</p>
      </div>
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
                <ClickToCallPhone phone={lead.phone} />
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
              <LeadCommunications leadId={id} leadPhone={lead.phone} />
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
