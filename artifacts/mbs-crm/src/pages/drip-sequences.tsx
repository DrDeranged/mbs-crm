import { useState } from "react";
import {
  useListDripSequences, useCreateDripSequence, useUpdateDripSequence,
  useGetDripSequence, useUpsertDripSequenceSteps, useListEmailTemplates,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Zap, GitBranch, Trash2, GripVertical, ChevronDown, ChevronRight, ChevronUp, Clock, Mail } from "lucide-react";

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

function SequenceFormDialog({ sequence, trigger }: { sequence?: any; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(sequence?.name ?? "");
  const [triggerStatus, setTriggerStatus] = useState(sequence?.triggerStatus ?? "");
  const [isActive, setIsActive] = useState(sequence?.isActive ?? true);
  const create = useCreateDripSequence();
  const update = useUpdateDripSequence();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const isEditing = !!sequence;
  const isBusy = create.isPending || update.isPending;

  const handleSave = () => {
    if (!name.trim() || !triggerStatus) {
      toast({ title: "Name and trigger status are required", variant: "destructive" });
      return;
    }
    const payload = { name: name.trim(), triggerStatus, isActive };
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["drip-sequences"] });
        setOpen(false);
        toast({ title: isEditing ? "Sequence updated" : "Sequence created" });
      },
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    };
    if (isEditing) {
      update.mutate({ id: sequence.id, data: payload }, opts);
    } else {
      create.mutate({ data: payload }, opts);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && !isEditing) { setName(""); setTriggerStatus(""); setIsActive(true); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Sequence" : "New Drip Sequence"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Sequence Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Lead Welcome Series" />
          </div>
          <div className="space-y-1">
            <Label>Trigger Status *</Label>
            <Select value={triggerStatus} onValueChange={setTriggerStatus}>
              <SelectTrigger><SelectValue placeholder="When lead moves to…" /></SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Auto-enroll leads when their status changes to this stage.</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="seq-active" />
            <Label htmlFor="seq-active">Active (auto-enroll enabled)</Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isBusy} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
              {isBusy ? "Saving…" : isEditing ? "Save Changes" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepBuilder({ sequenceId }: { sequenceId: number }) {
  const { data: seq, isLoading } = useGetDripSequence(sequenceId, { query: { queryKey: ["drip-seq-detail", sequenceId] } });
  const { data: templates } = useListEmailTemplates();
  const upsertSteps = useUpsertDripSequenceSteps();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [steps, setSteps] = useState<Array<{ templateId: string; delayHours: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  if (!loaded && seq?.steps) {
    setSteps((seq.steps as any[]).map((s: any) => ({ templateId: String(s.templateId), delayHours: s.delayHours })));
    setLoaded(true);
  }

  const addStep = () => setSteps((prev) => [...prev, { templateId: "", delayHours: 0 }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i));
  const updateStep = (i: number, field: "templateId" | "delayHours", value: any) => {
    setSteps((prev) => prev.map((s, j) => j === i ? { ...s, [field]: value } : s));
  };
  const moveStep = (i: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      return arr;
    });
  };

  const handleSave = () => {
    const invalid = steps.some((s) => !s.templateId);
    if (invalid) {
      toast({ title: "Each step needs a template", variant: "destructive" });
      return;
    }
    upsertSteps.mutate(
      { id: sequenceId, data: { steps: steps.map((s) => ({ templateId: parseInt(s.templateId), delayHours: s.delayHours })) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["drip-sequences"] });
          queryClient.invalidateQueries({ queryKey: ["drip-seq-detail", sequenceId] });
          toast({ title: "Steps saved" });
        },
        onError: () => toast({ title: "Failed to save steps", variant: "destructive" }),
      }
    );
  };

  if (isLoading) return <div className="p-4 space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;

  const activeTemplates = (templates ?? []).filter((t: any) => t.isActive);

  return (
    <div className="p-4 bg-slate-50 border-t space-y-3">
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Email Steps</p>
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-lg">
          No steps yet. Add your first email step.
        </p>
      ) : (
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 bg-white border rounded-lg p-2">
              <div className="flex flex-col flex-shrink-0">
                <button
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  className="h-4 w-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move up"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                  className="h-4 w-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed"
                  title="Move down"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1F4E79] text-white text-[10px] font-bold flex-shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                <Select value={step.templateId} onValueChange={(v) => updateStep(i, "templateId", v)}>
                  <SelectTrigger className="flex-1 min-w-[160px] h-8 text-xs">
                    <SelectValue placeholder="Select template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTemplates.map((t: any) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Clock className="h-3 w-3 text-slate-400" />
                  <Input
                    type="number"
                    min={0}
                    value={step.delayHours}
                    onChange={(e) => updateStep(i, "delayHours", parseInt(e.target.value) || 0)}
                    className="w-16 h-8 text-xs text-center"
                  />
                  <span className="text-xs text-muted-foreground">hrs delay</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                onClick={() => removeStep(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <Button size="sm" variant="outline" onClick={addStep} className="text-xs h-8">
          <Plus className="h-3 w-3 mr-1" /> Add Step
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={upsertSteps.isPending}
          className="bg-[#1F4E79] hover:bg-[#163a5f] text-white text-xs h-8"
        >
          {upsertSteps.isPending ? "Saving…" : "Save Steps"}
        </Button>
      </div>
    </div>
  );
}

function SequenceCard({ seq }: { seq: any }) {
  const [expanded, setExpanded] = useState(false);

  const triggerLabel = LEAD_STATUSES.find((s) => s.value === seq.triggerStatus)?.label ?? seq.triggerStatus;

  return (
    <Card className={`transition-shadow hover:shadow-sm ${!seq.isActive ? "opacity-60" : ""}`}>
      <CardContent className="p-0">
        <div className="p-4 flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 border border-amber-100 flex-shrink-0">
            <Zap className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-sm">{seq.name}</span>
              {!seq.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
              {seq.isActive && <Badge className="text-[10px] bg-green-50 text-green-700 border-green-200">Active</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <GitBranch className="h-3 w-3" /> Trigger: <strong className="text-slate-700">{triggerLabel}</strong>
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Mail className="h-3 w-3" /> {seq.stepCount} step{seq.stepCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <SequenceFormDialog
              sequence={seq}
              trigger={
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">Edit</Button>
              }
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setExpanded((p) => !p)}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {expanded && <StepBuilder sequenceId={seq.id} />}
      </CardContent>
    </Card>
  );
}

export default function DripSequences() {
  const { data: sequences, isLoading } = useListDripSequences({ query: { queryKey: ["drip-sequences"] } });

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Drip Sequences</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated email campaigns triggered by lead status changes.
          </p>
        </div>
        <SequenceFormDialog
          trigger={
            <Button className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
              <Plus className="h-4 w-4 mr-1.5" /> New Sequence
            </Button>
          }
        />
      </div>

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="pt-4 pb-3 flex items-start gap-3">
          <Zap className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800">
            <strong>How it works:</strong> When a lead's status changes to the trigger stage, they are automatically
            enrolled in the matching active sequence. Each step sends an email after the configured delay (hours).
            The drip engine runs every 10 minutes. Leads can be manually enrolled or unenrolled from the lead detail page.
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : !sequences || sequences.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground">
          <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No sequences yet</p>
          <p className="text-sm">Create your first drip sequence to automate lead nurturing.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map((seq: any) => (
            <SequenceCard key={seq.id} seq={seq} />
          ))}
        </div>
      )}
    </div>
  );
}
