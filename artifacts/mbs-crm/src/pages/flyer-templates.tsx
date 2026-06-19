import { useState } from "react";
import { useGetMe, useListFlyerTemplates, useCreateFlyerTemplate, useUpdateFlyerTemplate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Megaphone, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type VariableField = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  defaultValue: string;
  options?: string[];
};

type TemplateFormState = {
  name: string;
  programType: "equipment" | "working_capital" | "general";
  htmlTemplate: string;
  variableFields: VariableField[];
  isActive: boolean;
};

const emptyForm = (): TemplateFormState => ({
  name: "",
  programType: "general",
  htmlTemplate: "",
  variableFields: [],
  isActive: true,
});

function VariableFieldEditor({
  fields,
  onChange,
}: {
  fields: VariableField[];
  onChange: (fields: VariableField[]) => void;
}) {
  const addField = () => {
    onChange([...fields, { key: "", label: "", type: "text", defaultValue: "" }]);
  };
  const updateField = (i: number, patch: Partial<VariableField>) => {
    const updated = fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(updated);
  };
  const removeField = (i: number) => onChange(fields.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <Label className="text-xs font-semibold">Variable Fields</Label>
        <Button type="button" size="sm" variant="outline" onClick={addField} className="h-7 text-xs">
          <Plus className="h-3 w-3 mr-1" /> Add Field
        </Button>
      </div>
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No variables yet. Add fields to make the template customizable.</p>
      )}
      {fields.map((f, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 bg-muted/50 rounded-md p-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Key (used in template as {"{{key}}"})</Label>
            <Input
              className="h-7 text-xs"
              placeholder="e.g. rep_name"
              value={f.key}
              onChange={(e) => updateField(i, { key: e.target.value.replace(/\s/g, "_") })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Label (shown to user)</Label>
            <Input
              className="h-7 text-xs"
              placeholder="e.g. Rep Name"
              value={f.label}
              onChange={(e) => updateField(i, { label: e.target.value })}
            />
          </div>
          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 mt-4 text-destructive" onClick={() => removeField(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Default Value</Label>
            <Input
              className="h-7 text-xs"
              placeholder="Default..."
              value={f.defaultValue}
              onChange={(e) => updateField(i, { defaultValue: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateDialog({
  trigger,
  initial,
  onSave,
  title,
}: {
  trigger: React.ReactNode;
  initial?: TemplateFormState;
  onSave: (data: TemplateFormState) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(initial ?? emptyForm());
  const set = (patch: Partial<TemplateFormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = () => {
    if (!form.name.trim() || !form.htmlTemplate.trim()) return;
    onSave(form);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setForm(initial ?? emptyForm()); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Template Name *</Label>
              <Input
                placeholder="e.g. Working Capital Flyer"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Program Type</Label>
              <Select value={form.programType} onValueChange={(v) => set({ programType: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="working_capital">Working Capital</SelectItem>
                  <SelectItem value="equipment">Equipment Financing</SelectItem>
                  <SelectItem value="general">General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>HTML Template *</Label>
            <p className="text-xs text-muted-foreground">Use {"{{variable_key}}"} syntax to insert dynamic fields.</p>
            <Textarea
              className="font-mono text-xs min-h-[240px]"
              placeholder="<!DOCTYPE html><html>..."
              value={form.htmlTemplate}
              onChange={(e) => set({ htmlTemplate: e.target.value })}
            />
          </div>

          <VariableFieldEditor fields={form.variableFields} onChange={(vf) => set({ variableFields: vf })} />

          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={(v) => set({ isActive: v })} />
            <Label>Active (available for use)</Label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              className="bg-[#1F4E79] hover:bg-[#163a5f] text-white"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.htmlTemplate.trim()}
            >
              Save Template
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function FlyerTemplatesPage() {
  const { data: me } = useGetMe();
  const { data: templates = [], isLoading } = useListFlyerTemplates();
  const createTemplate = useCreateFlyerTemplate();
  const updateTemplate = useUpdateFlyerTemplate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (me?.role !== "admin") {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  const handleCreate = (form: TemplateFormState) => {
    createTemplate.mutate(
      { data: form },
      {
        onSuccess: () => {
          toast({ title: "Template created" });
          queryClient.invalidateQueries({ queryKey: ["listFlyerTemplates"] });
        },
        onError: () => toast({ title: "Failed to create template", variant: "destructive" }),
      }
    );
  };

  const handleUpdate = (id: number, form: TemplateFormState) => {
    updateTemplate.mutate(
      { id, data: form },
      {
        onSuccess: () => {
          toast({ title: "Template updated" });
          queryClient.invalidateQueries({ queryKey: ["listFlyerTemplates"] });
        },
        onError: () => toast({ title: "Failed to update template", variant: "destructive" }),
      }
    );
  };

  const programLabel = (pt: string) =>
    pt === "working_capital" ? "Working Capital" : pt === "equipment" ? "Equipment" : "General";

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1F4E79] flex items-center gap-2">
            <Megaphone className="h-6 w-6" /> Flyer Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage branded PDF flyer templates for marketing to leads.
          </p>
        </div>
        <TemplateDialog
          title="Create Flyer Template"
          trigger={
            <Button className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
              <Plus className="h-4 w-4 mr-2" /> New Template
            </Button>
          }
          onSave={handleCreate}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Megaphone className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="font-medium text-muted-foreground">No templates yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Starter templates will be seeded automatically on first load.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {templates.map((tmpl: any) => (
            <Card key={tmpl.id} className="border hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{tmpl.name}</CardTitle>
                    <CardDescription className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">{programLabel(tmpl.programType)}</Badge>
                      {tmpl.isActive
                        ? <Badge className="bg-green-100 text-green-700 text-xs">Active</Badge>
                        : <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                    </CardDescription>
                  </div>
                  <TemplateDialog
                    title="Edit Template"
                    trigger={
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    }
                    initial={{
                      name: tmpl.name,
                      programType: tmpl.programType,
                      htmlTemplate: tmpl.htmlTemplate,
                      variableFields: tmpl.variableFields ?? [],
                      isActive: tmpl.isActive,
                    }}
                    onSave={(form) => handleUpdate(tmpl.id, form)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {(tmpl.variableFields ?? []).length} variable field{(tmpl.variableFields ?? []).length !== 1 ? "s" : ""}
                  &nbsp;·&nbsp; Created {new Date(tmpl.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
