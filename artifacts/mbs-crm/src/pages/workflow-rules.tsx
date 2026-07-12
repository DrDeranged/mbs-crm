import { useState } from "react";
import { useListWorkflowRules, useCreateWorkflowRule, useUpdateWorkflowRule, useDeleteWorkflowRule, getListWorkflowRulesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Zap } from "lucide-react";

const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "application_received", label: "Application Received" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "funded", label: "Funded" },
  { value: "declined", label: "Declined" },
];

const ACTION_TYPES = [
  { value: "create_task", label: "Create Task" },
  { value: "send_notification", label: "Send Notification" },
];

function statusLabel(s: string) {
  return LEAD_STATUSES.find((x) => x.value === s)?.label ?? s;
}

type WorkflowRule = {
  id: number;
  name: string;
  triggerStatus: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
};

type FormState = {
  name: string;
  triggerStatus: string;
  actionType: "create_task" | "send_notification";
  taskTitle: string;
  taskDescription: string;
  dueDaysFromNow: string;
  notifTitle: string;
  notifBody: string;
  isActive: boolean;
};

const defaultForm = (): FormState => ({
  name: "",
  triggerStatus: "contacted",
  actionType: "create_task",
  taskTitle: "",
  taskDescription: "",
  dueDaysFromNow: "1",
  notifTitle: "",
  notifBody: "",
  isActive: true,
});

function ruleToForm(r: WorkflowRule): FormState {
  const cfg = r.actionConfig;
  return {
    name: r.name,
    triggerStatus: r.triggerStatus,
    actionType: r.actionType as "create_task" | "send_notification",
    taskTitle: (cfg["title"] as string) ?? "",
    taskDescription: (cfg["description"] as string) ?? "",
    dueDaysFromNow: String((cfg["dueDaysFromNow"] as number) ?? 1),
    notifTitle: (cfg["title"] as string) ?? "",
    notifBody: (cfg["body"] as string) ?? "",
    isActive: r.isActive,
  };
}

function formToPayload(f: FormState) {
  const actionConfig =
    f.actionType === "create_task"
      ? {
          title: f.taskTitle,
          description: f.taskDescription || undefined,
          dueDaysFromNow: Math.max(1, parseInt(f.dueDaysFromNow, 10) || 1),
        }
      : {
          title: f.notifTitle,
          body: f.notifBody,
        };
  return {
    name: f.name,
    triggerStatus: f.triggerStatus,
    actionType: f.actionType,
    actionConfig,
    isActive: f.isActive,
  };
}

export default function WorkflowRules() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rules = [], isLoading } = useListWorkflowRules();
  const createMutation = useCreateWorkflowRule();
  const updateMutation = useUpdateWorkflowRule();
  const deleteMutation = useDeleteWorkflowRule();

  async function invalidateRules() {
    await queryClient.invalidateQueries({ queryKey: getListWorkflowRulesQueryKey() });
  }

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [deleteTarget, setDeleteTarget] = useState<WorkflowRule | null>(null);

  function openCreate() {
    setEditingRule(null);
    setForm(defaultForm());
    setDialogOpen(true);
  }

  function openEdit(rule: WorkflowRule) {
    setEditingRule(rule);
    setForm(ruleToForm(rule));
    setDialogOpen(true);
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleToggle(rule: WorkflowRule) {
    try {
      await updateMutation.mutateAsync({ id: rule.id, data: { isActive: !rule.isActive } });
      await invalidateRules();
    } catch {
      toast({ title: "Failed to update rule", variant: "destructive" });
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.triggerStatus) {
      toast({ title: "Name and trigger status are required", variant: "destructive" });
      return;
    }
    if (form.actionType === "create_task" && !form.taskTitle.trim()) {
      toast({ title: "Task title is required", variant: "destructive" });
      return;
    }
    if (form.actionType === "send_notification" && !form.notifTitle.trim()) {
      toast({ title: "Notification title is required", variant: "destructive" });
      return;
    }
    try {
      const payload = formToPayload(form);
      if (editingRule) {
        await updateMutation.mutateAsync({ id: editingRule.id, data: payload });
        await invalidateRules();
        toast({ title: "Rule updated" });
      } else {
        await createMutation.mutateAsync({ data: payload });
        await invalidateRules();
        toast({ title: "Rule created" });
      }
      setDialogOpen(false);
    } catch {
      toast({ title: "Failed to save rule", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      await invalidateRules();
      toast({ title: "Rule deleted" });
      setDeleteTarget(null);
    } catch {
      toast({ title: "Failed to delete rule", variant: "destructive" });
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1F4E79] text-white">
            <Zap size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Workflow Rules</h1>
            <p className="text-sm text-slate-500">Automatically create tasks or send notifications when a lead changes status.</p>
          </div>
        </div>
        <Button onClick={openCreate} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white gap-2">
          <Plus size={16} />
          Add Rule
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-slate-400">Loading rules…</div>
      ) : rules.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Zap size={36} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No workflow rules yet</p>
          <p className="text-sm mt-1">Create a rule to automatically trigger actions when a lead moves to a new status.</p>
          <Button onClick={openCreate} className="mt-4 bg-[#1F4E79] hover:bg-[#163a5f] text-white gap-2">
            <Plus size={16} />
            Add Rule
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-white overflow-x-auto shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger Status</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rules as WorkflowRule[]).map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {statusLabel(rule.triggerStatus)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={rule.actionType === "create_task" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}
                    >
                      {rule.actionType === "create_task" ? "Create Task" : "Send Notification"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={() => handleToggle(rule)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(rule)}>
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setDeleteTarget(rule)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Edit Rule" : "Add Workflow Rule"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Rule Name</Label>
              <Input
                placeholder="e.g. Follow up after contact"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Trigger Status</Label>
                <Select value={form.triggerStatus} onValueChange={(v) => setField("triggerStatus", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Action Type</Label>
                <Select value={form.actionType} onValueChange={(v) => setField("actionType", v as "create_task" | "send_notification")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.actionType === "create_task" && (
              <>
                <div className="grid gap-1.5">
                  <Label>Task Title</Label>
                  <Input
                    placeholder="e.g. Follow up within 24h"
                    value={form.taskTitle}
                    onChange={(e) => setField("taskTitle", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Task Description <span className="text-slate-400 font-normal">(optional)</span></Label>
                  <Textarea
                    placeholder="What should the rep do?"
                    rows={2}
                    value={form.taskDescription}
                    onChange={(e) => setField("taskDescription", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Due in (days)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={form.dueDaysFromNow}
                    onChange={(e) => setField("dueDaysFromNow", e.target.value)}
                    className="w-28"
                  />
                </div>
              </>
            )}

            {form.actionType === "send_notification" && (
              <>
                <div className="grid gap-1.5">
                  <Label>Notification Title</Label>
                  <Input
                    placeholder="e.g. Lead status updated"
                    value={form.notifTitle}
                    onChange={(e) => setField("notifTitle", e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Notification Body</Label>
                  <Textarea
                    placeholder="e.g. A lead has moved to Approved"
                    rows={2}
                    value={form.notifBody}
                    onChange={(e) => setField("notifBody", e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Switch
                id="is-active"
                checked={form.isActive}
                onCheckedChange={(v) => setField("isActive", v)}
              />
              <Label htmlFor="is-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white"
            >
              {editingRule ? "Save Changes" : "Create Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be permanently deleted and will no longer trigger automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
