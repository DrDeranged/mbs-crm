import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useListEmailTemplates, useCreateEmailTemplate, useUpdateEmailTemplate, usePreviewEmailTemplate, useSendBulkEmail, useListLeads } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Mail, Edit2, Eye, CheckCircle, Send, Users, Loader2, Sparkles } from "lucide-react";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

function SeedTemplatesButton() {
  const [loading, setLoading] = useState(false);
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleSeed = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${apiBase}/email/seed-starter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      toast({ title: data.message });
    } catch (e: any) {
      toast({ title: e.message || "Failed to load starter templates", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      onClick={handleSeed}
      disabled={loading}
      className="gap-1.5 border-dashed"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      Load starter templates
    </Button>
  );
}

const PROGRAM_TYPES = [
  { value: "working_capital", label: "Working Capital" },
  { value: "equipment", label: "Equipment" },
];

const VARIABLES = [
  "{{lead_first_name}}", "{{lead_last_name}}", "{{lead_company}}",
  "{{lead_email}}", "{{lead_phone}}", "{{rep_name}}", "{{rep_email}}",
];

function TemplateFormDialog({
  template,
  trigger,
}: {
  template?: any;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? "");
  const [programType, setProgramType] = useState<string>(template?.programType ?? "none");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const createTemplate = useCreateEmailTemplate();
  const updateTemplate = useUpdateEmailTemplate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isEditing = !!template;
  const isBusy = createTemplate.isPending || updateTemplate.isPending;

  const handleSave = () => {
    const payload = {
      name: name.trim(),
      subject: subject.trim(),
      bodyHtml: bodyHtml.trim(),
      programType: programType === "none" ? null : (programType || null),
      isActive,
    };
    if (!payload.name || !payload.subject || !payload.bodyHtml) {
      toast({ title: "Name, subject, and body are required", variant: "destructive" });
      return;
    }
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["email-templates"] });
        setOpen(false);
        toast({ title: isEditing ? "Template updated" : "Template created" });
      },
      onError: () => toast({ title: "Failed to save template", variant: "destructive" }),
    };
    if (isEditing) {
      updateTemplate.mutate({ id: template.id, data: payload as any }, opts);
    } else {
      createTemplate.mutate({ data: payload as any }, opts);
    }
  };

  const insertVariable = (v: string) => {
    setBodyHtml((prev: string) => prev + v);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Template" : "New Email Template"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Template Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome Email" />
            </div>
            <div className="space-y-1">
              <Label>Program Type</Label>
              <Select value={programType} onValueChange={setProgramType}>
                <SelectTrigger><SelectValue placeholder="All programs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All programs</SelectItem>
                  {PROGRAM_TYPES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Subject Line *</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Your application status update" />
          </div>
          <div className="space-y-1">
            <Label>Body (HTML) *</Label>
            <div className="flex flex-wrap gap-1 mb-1">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="text-[10px] px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded border border-slate-200 font-mono"
                >
                  {v}
                </button>
              ))}
            </div>
            <Textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder="<p>Hi {{lead_first_name}},</p><p>...</p>"
              className="min-h-[200px] font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="is-active" />
            <Label htmlFor="is-active">Active</Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isBusy} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
              {isBusy ? "Saving…" : isEditing ? "Save Changes" : "Create Template"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({ template }: { template: any }) {
  const [open, setOpen] = useState(false);
  const preview = usePreviewEmailTemplate();
  const [previewData, setPreviewData] = useState<{ subject: string; bodyHtml: string } | null>(null);

  const handleOpen = () => {
    setOpen(true);
    preview.mutate({ id: template.id, data: {} }, {
      onSuccess: (data: any) => setPreviewData(data),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleOpen}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview: {template.name}</DialogTitle>
        </DialogHeader>
        {preview.isPending ? (
          <div className="space-y-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-40 w-full" /></div>
        ) : previewData ? (
          <div className="space-y-3">
            <div className="border rounded-md p-3 bg-slate-50">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Subject</span>
              <p className="mt-0.5 text-sm font-medium">{previewData.subject}</p>
            </div>
            <div className="border rounded-md p-3 bg-white prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: previewData.bodyHtml }}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const LEAD_STATUSES = [
  { value: "new_lead", label: "New Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "application_received", label: "Application Received" },
  { value: "submitted_to_underwriting", label: "Submitted to Underwriting" },
  { value: "approved", label: "Approved" },
  { value: "funded", label: "Funded" },
  { value: "declined", label: "Declined" },
  { value: "follow_up", label: "Follow Up" },
];

function BulkSendDialog({ template }: { template: any }) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const sendBulk = useSendBulkEmail();
  const { toast } = useToast();

  const { data: leadsData } = useListLeads(
    statusFilter && statusFilter !== "all" ? { status: statusFilter as any } : undefined,
    { query: { enabled: open, queryKey: ["bulk-send-leads", statusFilter] } }
  );

  const eligibleLeads = (leadsData?.leads ?? []).filter((l: any) => l.email && !l.isUnsubscribed);

  const handleSend = () => {
    const leadIds = eligibleLeads.map((l: any) => l.id);
    if (leadIds.length === 0) {
      toast({ title: "No eligible leads", description: "No leads with email addresses match this filter.", variant: "destructive" });
      return;
    }
    sendBulk.mutate(
      { data: { templateId: template.id, leadIds } },
      {
        onSuccess: (data: any) => {
          toast({ title: `Bulk email sent`, description: `Sent: ${data.sent ?? 0} · Failed: ${data.failed ?? 0} · Skipped: ${data.skipped ?? 0}` });
          setOpen(false);
        },
        onError: () => toast({ title: "Bulk send failed", variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" title="Send to multiple leads">
          <Users className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Send: {template.name}</DialogTitle>
          <DialogDescription>Send this template to all leads matching the selected filter. Unsubscribed leads and leads without email addresses are automatically excluded.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Filter by lead status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg border text-sm">
            <Users className="h-4 w-4 text-slate-500" />
            <span className="text-slate-700">
              <strong>{eligibleLeads.length}</strong> eligible lead{eligibleLeads.length !== 1 ? "s" : ""} with email addresses
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Subject: <span className="font-medium">{template.subject}</span></p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={sendBulk.isPending || eligibleLeads.length === 0}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {sendBulk.isPending ? "Sending…" : `Send to ${eligibleLeads.length} lead${eligibleLeads.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function EmailTemplates() {
  const { data: templates, isLoading } = useListEmailTemplates(undefined, { query: { queryKey: ["email-templates"] } });

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Email Templates</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage reusable email templates with variable substitution.</p>
        </div>
        <div className="flex items-center gap-2">
          <SeedTemplatesButton />
          <TemplateFormDialog
            trigger={
              <Button className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                <Plus className="h-4 w-4 mr-1.5" /> New Template
              </Button>
            }
          />
        </div>
      </div>

      {/* Variables reference */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground mb-2 font-medium">Available template variables:</p>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLES.map((v) => (
              <code key={v} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">{v}</code>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground">
          <Mail className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No templates yet</p>
          <p className="text-sm">Create your first email template to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t: any) => (
            <Card key={t.id} className={`transition-shadow hover:shadow-sm ${!t.isActive ? "opacity-60" : ""}`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 border border-purple-100 flex-shrink-0">
                    <Mail className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-900 text-sm">{t.name}</span>
                      {!t.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                      {t.programType && (
                        <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                          {t.programType === "working_capital" ? "Working Capital" : "Equipment"}
                        </Badge>
                      )}
                      {t.isActive && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">Subject: {t.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      By {t.creator?.name ?? t.creator?.email ?? "unknown"} · {new Date(t.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <PreviewDialog template={t} />
                    {t.isActive && <BulkSendDialog template={t} />}
                    <TemplateFormDialog
                      template={t}
                      trigger={
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
