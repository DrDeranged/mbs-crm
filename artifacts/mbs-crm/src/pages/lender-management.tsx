import { useState } from "react";
import { useGetMe, useListLenders, useCreateLender, useUpdateLender, useDeactivateLender } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Building2, DollarSign, Star, Phone, Mail, Trash2 } from "lucide-react";

import { parseNullableCurrency } from "@/lib/forms";

const PROGRAM_OPTIONS = ["working_capital", "equipment", "sba", "real_estate", "line_of_credit"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

interface LenderFormData {
  name: string;
  programTypes: string[];
  minAmount: string;
  maxAmount: string;
  minCreditScore: string;
  acceptedIndustries: string;
  restrictedIndustries: string;
  prohibitedIndustries: string;
  minMonthlyRevenue: string;
  minTimeInBusinessMonths: string;
  acceptedStates: string[];
  maxExistingPositions: string;
  priorityWeight: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  isActive: boolean;
}

const emptyForm = (): LenderFormData => ({
  name: "",
  programTypes: [],
  minAmount: "",
  maxAmount: "",
  minCreditScore: "",
  acceptedIndustries: "",
  restrictedIndustries: "",
  prohibitedIndustries: "",
  minMonthlyRevenue: "",
  minTimeInBusinessMonths: "",
  acceptedStates: [],
  maxExistingPositions: "10",
  priorityWeight: "5",
  contactName: "",
  contactEmail: "",
  notes: "",
  isActive: true,
});

function lenderToForm(l: any): LenderFormData {
  return {
    name: l.name ?? "",
    programTypes: l.programTypes ?? [],
    minAmount: l.minAmount != null ? String(l.minAmount) : "",
    maxAmount: l.maxAmount != null ? String(l.maxAmount) : "",
    minCreditScore: l.minCreditScore != null ? String(l.minCreditScore) : "",
    acceptedIndustries: (l.acceptedIndustries ?? []).join(", "),
    restrictedIndustries: (l.restrictedIndustries ?? []).join(", "),
    prohibitedIndustries: (l.prohibitedIndustries ?? []).join(", "),
    minMonthlyRevenue: l.minMonthlyRevenue != null ? String(l.minMonthlyRevenue) : "",
    minTimeInBusinessMonths: String(l.minTimeInBusinessMonths ?? 0),
    acceptedStates: l.acceptedStates ?? [],
    maxExistingPositions: String(l.maxExistingPositions ?? 10),
    priorityWeight: String(l.priorityWeight ?? 5),
    contactName: l.contactName ?? "",
    contactEmail: l.contactEmail ?? "",
    notes: l.notes ?? "",
    isActive: l.isActive ?? true,
  };
}

function formToPayload(f: LenderFormData) {
  return {
    name: f.name,
    programTypes: f.programTypes,
    minAmount: parseNullableCurrency(f.minAmount),
    maxAmount: parseNullableCurrency(f.maxAmount),
    minCreditScore: f.minCreditScore ? parseInt(f.minCreditScore, 10) : null,
    acceptedIndustries: f.acceptedIndustries
      ? f.acceptedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    restrictedIndustries: f.restrictedIndustries
      ? f.restrictedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    prohibitedIndustries: f.prohibitedIndustries
      ? f.prohibitedIndustries.split(",").map((s) => s.trim()).filter(Boolean)
      : [],
    minMonthlyRevenue: f.minMonthlyRevenue ? parseInt(f.minMonthlyRevenue, 10) : null,
    minTimeInBusinessMonths: f.minTimeInBusinessMonths ? parseInt(f.minTimeInBusinessMonths, 10) : null,
    acceptedStates: f.acceptedStates,
    maxExistingPositions: parseInt(f.maxExistingPositions, 10) || 10,
    priorityWeight: Math.max(1, Math.min(10, parseInt(f.priorityWeight, 10) || 5)),
    contactName: f.contactName || null,
    contactEmail: f.contactEmail || null,
    notes: f.notes || null,
    isActive: f.isActive,
  };
}

function ToggleChip({ value, selected, onChange, label }: { value: string; selected: boolean; onChange: (v: string, s: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value, !selected)}
      className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
        selected ? "bg-[#1F4E79] text-white border-[#1F4E79]" : "bg-white text-slate-600 border-slate-300 hover:border-[#1F4E79]"
      }`}
    >
      {label ?? value}
    </button>
  );
}

function LenderForm({ initial, onSubmit, loading }: { initial: LenderFormData; onSubmit: (d: LenderFormData) => void; loading: boolean }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (key: keyof LenderFormData, val: any) => {
    setForm((f) => ({ ...f, [key]: val }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: "" }));
  };

  const toggleProgram = (v: string, s: boolean) =>
    set("programTypes", s ? [...form.programTypes, v] : form.programTypes.filter((p) => p !== v));

  const toggleState = (v: string, s: boolean) =>
    set("acceptedStates", s ? [...form.acceptedStates, v] : form.acceptedStates.filter((p) => p !== v));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "Lender name is required";
    if (form.minAmount && form.maxAmount && Number(form.minAmount) > Number(form.maxAmount)) {
      newErrors.maxAmount = "Max amount must be greater than min amount";
    }
    if (form.minCreditScore && (Number(form.minCreditScore) < 300 || Number(form.minCreditScore) > 850)) {
      newErrors.minCreditScore = "Score must be 300-850";
    }
    if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
      newErrors.contactEmail = "Invalid email format";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      onSubmit(form);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div>
        <Label>Lender name <span className="text-red-500">*</span></Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. First Capital Funding" className="mt-1" />
        {errors.name && <p className="text-[13px] text-red-500 mt-1">{errors.name}</p>}
      </div>

      <div>
        <Label>Program types</Label>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {PROGRAM_OPTIONS.map((p) => (
            <ToggleChip key={p} value={p} selected={form.programTypes.includes(p)} onChange={toggleProgram}
              label={p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Min amount</Label>
          <div className="relative mt-1.5">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" value={form.minAmount} onChange={(e) => set("minAmount", e.target.value)} placeholder="0.00" className="pl-8" />
          </div>
        </div>
        <div>
          <Label>Max amount</Label>
          <div className="relative mt-1.5">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" value={form.maxAmount} onChange={(e) => set("maxAmount", e.target.value)} placeholder="0.00" className="pl-8" />
          </div>
          {errors.maxAmount && <p className="text-[13px] text-red-500 mt-1">{errors.maxAmount}</p>}
        </div>
        <div>
          <Label>Min credit score</Label>
          <Input type="number" value={form.minCreditScore} onChange={(e) => set("minCreditScore", e.target.value)} placeholder="580" className="mt-1.5" />
          {errors.minCreditScore && <p className="text-[13px] text-red-500 mt-1">{errors.minCreditScore}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label>Min Time in Biz (mo.)</Label>
          <Input type="number" value={form.minTimeInBusinessMonths} onChange={(e) => set("minTimeInBusinessMonths", e.target.value)} placeholder="6" className="mt-1" />
        </div>
        <div>
          <Label>Max Existing Positions</Label>
          <Input type="number" value={form.maxExistingPositions} onChange={(e) => set("maxExistingPositions", e.target.value)} placeholder="3" className="mt-1" />
        </div>
        <div>
          <Label>Priority Weight (1–10)</Label>
          <Input type="number" min={1} max={10} value={form.priorityWeight} onChange={(e) => set("priorityWeight", e.target.value)} placeholder="5" className="mt-1" />
        </div>
      </div>

      <div>
        <Label>Accepted Industries (comma-separated)</Label>
        <Input value={form.acceptedIndustries} onChange={(e) => set("acceptedIndustries", e.target.value)} placeholder="Retail, Restaurant, Healthcare" className="mt-1" />
        <p className="text-xs text-muted-foreground mt-0.5">Leave blank to accept all industries</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <Label>Restricted Industries (comma-separated)</Label>
          <Input value={form.restrictedIndustries} onChange={(e) => set("restrictedIndustries", e.target.value)} placeholder="Construction, trucking" className="mt-1" />
          <p className="text-xs text-muted-foreground mt-0.5">Restricted industries are excluded unless their stated lender exception is met.</p>
        </div>
        <div>
          <Label>Prohibited industries (comma-separated)</Label>
          <Input value={form.prohibitedIndustries} onChange={(e) => set("prohibitedIndustries", e.target.value)} placeholder="Cannabis, gambling" className="mt-1" />
        </div>
        <div>
          <Label>Minimum monthly revenue</Label>
          <div className="relative mt-1.5">
            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input type="number" min="0" value={form.minMonthlyRevenue} onChange={(e) => set("minMonthlyRevenue", e.target.value)} placeholder="0.00" className="pl-8" />
          </div>
        </div>
      </div>

      <div>
        <Label>Accepted states</Label>
        <p className="text-xs text-muted-foreground mb-1.5">Leave all unselected to accept all states</p>
        <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto border rounded-md p-2">
          {US_STATES.map((s) => (
            <ToggleChip key={s} value={s} selected={form.acceptedStates.includes(s)} onChange={toggleState} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Contact name</Label>
          <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Jane Smith" className="mt-1" />
        </div>
        <div>
          <Label>Contact email</Label>
          <Input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="jane@lender.com" className="mt-1" />
          {errors.contactEmail && <p className="text-[13px] text-red-500 mt-1">{errors.contactEmail}</p>}
        </div>
      </div>

      <div>
        <Label>Internal notes</Label>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any notes about this lender…" className="mt-1 min-h-[60px] resize-none" />
      </div>

      <Button type="submit" disabled={!form.name.trim() || Object.keys(errors).some(k => errors[k]) || loading} className="w-full bg-[#1F4E79] hover:bg-[#163a5f] text-white">
        {loading ? "Saving…" : "Save Lender"}
      </Button>
    </form>
  );
}

function priorityStars(weight: number) {
  const filled = Math.round((weight / 10) * 5);
  return Array.from({ length: 5 }).map((_, i) => (
    <Star key={i} className={`h-3 w-3 ${i < filled ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
  ));
}

export default function LenderManagement() {
  const { data: me } = useGetMe();
  const { data: lenders, isLoading } = useListLenders();
  const createLender = useCreateLender();
  const updateLender = useUpdateLender();
  const deactivateLender = useDeactivateLender();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const isAdmin = me?.role === "admin";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["listLenders"] });

  const handleCreate = (form: LenderFormData) => {
    createLender.mutate({ data: formToPayload(form) as any }, {
      onSuccess: () => { setCreateOpen(false); invalidate(); toast({ title: "Lender created" }); },
      onError: (err: any) => toast({ title: "Failed to create lender", description: err.response?.data?.message || err.message, variant: "destructive" }),
    });
  };

  const handleUpdate = (form: LenderFormData) => {
    if (!editTarget) return;
    updateLender.mutate({ id: editTarget.id, data: formToPayload(form) as any }, {
      onSuccess: () => { setEditTarget(null); invalidate(); toast({ title: "Lender updated" }); },
      onError: (err: any) => toast({ title: "Failed to update lender", description: err.response?.data?.message || err.message, variant: "destructive" }),
    });
  };

  const handleDeactivate = (id: number, name: string) => {
    if (!confirm(`Deactivate "${name}"? This lender will no longer appear in matches.`)) return;
    deactivateLender.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Lender deactivated" }); },
      onError: () => toast({ title: "Failed to deactivate lender", variant: "destructive" }),
    });
  };

  const visible = (lenders ?? []).filter((l: any) => showInactive || l.isActive);

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Lender Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage your lender network and matching criteria</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
            Show inactive
          </label>
          {isAdmin && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                  <Plus className="h-4 w-4 mr-1" /> Add Lender
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Add Lender</DialogTitle>
                  <DialogDescription>Configure lender criteria for the matching engine</DialogDescription>
                </DialogHeader>
                <LenderForm initial={emptyForm()} onSubmit={handleCreate} loading={createLender.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No lenders yet</p>
          {isAdmin && <p className="text-sm mt-1">Click "Add Lender" to get started</p>}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((lender: any) => (
            <Card key={lender.id} className={`border transition-shadow hover:shadow-md ${!lender.isActive ? "opacity-60" : ""}`}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-800">{lender.name}</h3>
                      {!lender.isActive && <Badge variant="outline" className="text-[10px] text-slate-400">Inactive</Badge>}
                    </div>
                    <div className="flex items-center gap-0.5 mt-0.5">{priorityStars(lender.priorityWeight)}</div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditTarget(lender)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {lender.isActive && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDeactivate(lender.id, lender.name)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 text-xs text-slate-600">
                  {(lender.programTypes?.length > 0) && (
                    <div className="flex flex-wrap gap-1">
                      {lender.programTypes.map((pt: string) => (
                        <Badge key={pt} variant="secondary" className="text-[10px] h-4 px-1.5 bg-blue-50 text-blue-700">
                          {pt.replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {(lender.minAmount != null || lender.maxAmount != null) && (
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3 text-green-600" />
                        {lender.minAmount != null ? `$${(lender.minAmount / 1000).toFixed(0)}k` : "any"}
                        {" – "}
                        {lender.maxAmount != null ? `$${(lender.maxAmount / 1000).toFixed(0)}k` : "any"}
                      </span>
                    )}
                    {lender.minCreditScore != null && (
                      <span>FICO ≥ {lender.minCreditScore}</span>
                    )}
                    {lender.minTimeInBusinessMonths > 0 && (
                      <span>≥ {lender.minTimeInBusinessMonths} mo.</span>
                    )}
                  </div>
                  {lender.acceptedStates?.length > 0 && (
                    <p className="text-[10px] text-slate-400">States: {lender.acceptedStates.slice(0, 8).join(", ")}{lender.acceptedStates.length > 8 ? ` +${lender.acceptedStates.length - 8}` : ""}</p>
                  )}
                  {(lender.contactName || lender.contactEmail) && (
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground border-t pt-1.5 mt-1.5">
                      {lender.contactName && <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{lender.contactName}</span>}
                      {lender.contactEmail && <span className="flex items-center gap-1"><Mail className="h-2.5 w-2.5" />{lender.contactEmail}</span>}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit dialog */}
      {editTarget && (
        <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Lender</DialogTitle>
              <DialogDescription>Update criteria for {editTarget.name}</DialogDescription>
            </DialogHeader>
            <LenderForm initial={lenderToForm(editTarget)} onSubmit={handleUpdate} loading={updateLender.isPending} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
