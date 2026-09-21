import { useState } from "react";
import { useGetMe, useListLenders, useCreateLender, useUpdateLender, useDeactivateLender } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Building2, DollarSign, Star, Trash2, FileText, AlertTriangle, FileWarning, HelpCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseNullableCurrency } from "@/lib/forms";
import { PartnerContactsDialog } from "@/components/partner-contacts-dialog";
import { type LenderFormData, emptyForm, lenderToForm, formToPayload } from "@/lib/lender-form";

const PROGRAM_OPTIONS = ["working_capital", "equipment", "sba", "real_estate", "line_of_credit"];
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

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
    if (!form.name.trim()) newErrors.name = "Partner name is required";
    if (form.minAmount && form.maxAmount && Number(form.minAmount) > Number(form.maxAmount)) {
      newErrors.maxAmount = "Max amount must be greater than min amount";
    }
    if (form.minCreditScore && (Number(form.minCreditScore) < 300 || Number(form.minCreditScore) > 850)) {
      newErrors.minCreditScore = "Score must be 300-850";
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length === 0) {
      onSubmit(form);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Partner name <span className="text-red-500">*</span></Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. First Capital Funding" className="mt-1" />
          {errors.name && <p className="text-[13px] text-red-500 mt-1">{errors.name}</p>}
        </div>
        <div>
          <Label>Partner Type</Label>
          <Select value={form.partnerType} onValueChange={v => set("partnerType", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct_lender">Direct Lender</SelectItem>
              <SelectItem value="broker_out">Broker Out</SelectItem>
              <SelectItem value="broker_in">Broker In</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {form.partnerType === "broker_in" && (
        <div>
          <Label>Referral Split %</Label>
          <Input type="number" min="0" max="100" value={form.referralSplitPct} onChange={e => set("referralSplitPct", e.target.value)} placeholder="50" className="mt-1" />
        </div>
      )}

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

      <div className="flex items-center gap-2 mt-4 mb-2">
        <input type="checkbox" id="reqFin" checked={form.requiresFinancialStatements} onChange={e => set("requiresFinancialStatements", e.target.checked)} className="rounded" />
        <Label htmlFor="reqFin" className="cursor-pointer">Requires Financial Statements (Documents)</Label>
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

      <div className="border-t pt-4 space-y-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Published underwriting guideline</h4>
          <p className="text-xs text-muted-foreground">Only enter terms supported by the lender’s source material. Blank values are omitted from recommendations.</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>Version</Label><Input type="number" min="1" value={form.guidelineVersion} onChange={(e) => set("guidelineVersion", e.target.value)} className="mt-1" /></div>
          <div className="col-span-2"><Label>Source / document reference</Label><Input value={form.guidelineSource} onChange={(e) => set("guidelineSource", e.target.value)} placeholder="Credit box dated…" className="mt-1" /></div>
          <div><Label>Effective date</Label><Input type="date" value={form.guidelineEffectiveAt} onChange={(e) => set("guidelineEffectiveAt", e.target.value)} className="mt-1" /></div>
          <div className="col-span-2"><Label>Equipment restrictions</Label><Input value={form.equipmentRestrictions} onChange={(e) => set("equipmentRestrictions", e.target.value)} placeholder="Aircraft, titled vehicles over 15 years" className="mt-1" /></div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div><Label>Rate min %</Label><Input type="number" step="0.01" value={form.pricingMin} onChange={(e) => set("pricingMin", e.target.value)} className="mt-1" /></div>
          <div><Label>Rate max %</Label><Input type="number" step="0.01" value={form.pricingMax} onChange={(e) => set("pricingMax", e.target.value)} className="mt-1" /></div>
          <div><Label>Max advance %</Label><Input type="number" step="0.01" value={form.maxAdvancePct} onChange={(e) => set("maxAdvancePct", e.target.value)} className="mt-1" /></div>
          <div><Label>Min down %</Label><Input type="number" step="0.01" value={form.minDownPaymentPct} onChange={(e) => set("minDownPaymentPct", e.target.value)} className="mt-1" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Structures</Label><Input value={form.structures} onChange={(e) => set("structures", e.target.value)} placeholder="EFA, lease, loan" className="mt-1" /></div>
          <div><Label>Terms in months</Label><Input value={form.termMonths} onChange={(e) => set("termMonths", e.target.value)} placeholder="24, 36, 48, 60" className="mt-1" /></div>
          <div className="col-span-2"><Label>Required documents</Label><Input value={form.requiredDocuments} onChange={(e) => set("requiredDocuments", e.target.value)} placeholder="Application, 3 bank statements, invoice" className="mt-1" /></div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <div><Label>Turnaround min days</Label><Input type="number" min="0" value={form.turnaroundMin} onChange={(e) => set("turnaroundMin", e.target.value)} className="mt-1" /></div>
          <div><Label>Turnaround max days</Label><Input type="number" min="0" value={form.turnaroundMax} onChange={(e) => set("turnaroundMax", e.target.value)} className="mt-1" /></div>
          <div>
            <Label>Broker comp.</Label>
            <Select value={form.compensationType} onValueChange={(v) => set("compensationType", v)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="points">Points</SelectItem><SelectItem value="percent">Percent</SelectItem><SelectItem value="flat">Flat $</SelectItem></SelectContent>
            </Select>
          </div>
          <div><Label>{form.compensationType === "flat" ? "Flat amount" : "Comp. min / max"}</Label><div className="flex gap-1 mt-1"><Input type="number" step="0.01" value={form.compensationMin} onChange={(e) => set("compensationMin", e.target.value)} />{form.compensationType !== "flat" && <Input type="number" step="0.01" value={form.compensationMax} onChange={(e) => set("compensationMax", e.target.value)} />}</div></div>
        </div>
      </div>

      <div>
        <Label>Internal notes (Turnaround time, general notes)</Label>
        <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any notes about this partner..." className="mt-1 min-h-[60px] resize-none" />
      </div>

      <Button type="submit" disabled={!form.name.trim() || Object.keys(errors).some(k => errors[k]) || loading} className="w-full bg-[#1F4E79] hover:bg-[#163a5f] text-white">
        {loading ? "Saving…" : "Save Partner"}
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

function PartnerCard({ partner, isAdmin, onEdit, onDeactivate }: { partner: any, isAdmin: boolean, onEdit: (p: any) => void, onDeactivate: (id: number, name: string) => void }) {
  const isBrokerIn = partner.partnerType === "broker_in";

  return (
    <Card className={`border overflow-hidden transition-all hover:shadow-md ${!partner.isActive ? "opacity-60 bg-slate-50" : "bg-white"}`}>
      <CardContent className="p-0">
        <div className="p-4 border-b bg-slate-50/50 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800 text-base">{partner.name}</h3>
              {!partner.isActive && <Badge variant="outline" className="text-[10px] text-slate-400">Inactive</Badge>}
            </div>
            <div className="flex items-center gap-0.5 mt-1">{priorityStars(partner.priorityWeight)}</div>
            {isBrokerIn && partner.referralSplitPct != null && (
              <div className="mt-1.5 text-xs text-blue-700 font-medium bg-blue-50 w-fit px-2 py-0.5 rounded-full border border-blue-100">
                {partner.referralSplitPct}% Referral Split
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <PartnerContactsDialog partnerId={partner.id} partnerName={partner.name} />
            {isAdmin && (
              <div className="flex items-center border-l pl-2 ml-1 border-slate-200 gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-400 hover:text-slate-800 hover:bg-slate-200" onClick={() => onEdit(partner)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {partner.isActive && (
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => onDeactivate(partner.id, partner.name)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 space-y-4 text-sm">
          {partner.submissionStats && (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-white shadow-sm">
              <div className="text-center px-3 border-r">
                <div className="text-2xl font-semibold text-slate-800">{partner.submissionStats.submitted}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Submitted</div>
              </div>
              <div className="text-center px-3 border-r">
                <div className="text-2xl font-semibold text-[#17A567]">{partner.submissionStats.approved}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Approved</div>
              </div>
              <div className="text-center px-3 border-r">
                <div className="text-2xl font-semibold text-red-500">{partner.submissionStats.declined}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Declined</div>
              </div>
              <div className="text-center px-3">
                <div className="text-2xl font-semibold text-blue-600">{partner.submissionStats.approvalRate}%</div>
                <div className="text-[10px] uppercase tracking-wider text-blue-600/70 font-medium">Win Rate</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            {partner.programTypes?.length > 0 && (
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">Programs</div>
                <div className="flex flex-wrap gap-1">
                  {partner.programTypes.map((pt: string) => (
                    <Badge key={pt} variant="secondary" className="text-[10px] h-4 px-1.5 bg-blue-50 text-blue-700">
                      {pt.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Deal Size</div>
              <div className="font-medium text-slate-700">
                {(partner.minAmount != null || partner.maxAmount != null) ? (
                  <span className="flex items-center gap-1">
                    {partner.minAmount != null ? `$${(partner.minAmount / 1000).toFixed(0)}k` : "any"}
                    {" – "}
                    {partner.maxAmount != null ? `$${(partner.maxAmount / 1000).toFixed(0)}k` : "any"}
                  </span>
                ) : "No limits"}
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Min Requirements</div>
              <div className="font-medium text-slate-700 flex flex-wrap gap-x-3 gap-y-1">
                {partner.minCreditScore != null && <span>{partner.minCreditScore} FICO</span>}
                {partner.minTimeInBusinessMonths > 0 && <span>{partner.minTimeInBusinessMonths} mo. TIB</span>}
                {partner.minMonthlyRevenue > 0 && <span>${(partner.minMonthlyRevenue / 1000).toFixed(0)}k/mo rev</span>}
                {partner.minCreditScore == null && !partner.minTimeInBusinessMonths && !partner.minMonthlyRevenue && "Standard"}
              </div>
            </div>
          </div>

          <div className="border-t pt-3 space-y-3">
            {partner.requiresFinancialStatements && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-2 rounded-md border border-amber-200/50">
                <FileText className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Financial Statements Required</span>
                  This partner requires full financial documents (P&L, Balance Sheet) for submissions.
                </div>
              </div>
            )}

            {(partner.restrictedIndustries?.length > 0 || partner.prohibitedIndustries?.length > 0) && (
              <div className="flex items-start gap-2 text-xs text-slate-700 bg-slate-50 p-2 rounded-md border border-slate-200">
                <FileWarning className="h-4 w-4 shrink-0 mt-0.5 text-slate-500" />
                <div className="space-y-1">
                  {partner.restrictedIndustries?.length > 0 && (
                    <div><span className="font-semibold">Restricted:</span> {partner.restrictedIndustries.join(", ")}</div>
                  )}
                  {partner.prohibitedIndustries?.length > 0 && (
                    <div><span className="font-semibold text-red-600">Prohibited:</span> {partner.prohibitedIndustries.join(", ")}</div>
                  )}
                </div>
              </div>
            )}

            {partner.notes && (
              <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded-md border border-slate-100">
                <div className="font-semibold text-slate-500 mb-0.5 text-[10px] uppercase tracking-wider">Internal Notes / Turnaround</div>
                <div className="whitespace-pre-wrap">{partner.notes}</div>
              </div>
            )}
            {(partner.guidelineSource || partner.pricing || partner.requiredDocuments?.length > 0) && (
              <div className="text-xs bg-blue-50/60 border border-blue-100 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-blue-900">Underwriting guideline v{partner.guidelineVersion ?? 1}</span>
                  {partner.guidelineEffectiveAt && <span className="text-blue-700">Effective {new Date(partner.guidelineEffectiveAt).toLocaleDateString()}</span>}
                </div>
                {partner.guidelineSource && <div><span className="font-medium">Source:</span> {partner.guidelineSource}</div>}
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="font-medium">Pricing:</span> {partner.pricing?.minRatePct != null ? `${partner.pricing.minRatePct}%${partner.pricing.maxRatePct != null ? `–${partner.pricing.maxRatePct}%` : ""}` : "Not documented"}</div>
                  <div><span className="font-medium">Turnaround:</span> {partner.turnaroundBusinessDaysMin != null || partner.turnaroundBusinessDaysMax != null ? `${partner.turnaroundBusinessDaysMin ?? "?"}–${partner.turnaroundBusinessDaysMax ?? "?"} business days` : "Not documented"}</div>
                </div>
                {partner.requiredDocuments?.length > 0 && <div><span className="font-medium">Documents:</span> {partner.requiredDocuments.join(", ")}</div>}
                {partner.equipmentRestrictions?.length > 0 && <div className="text-amber-800"><span className="font-medium">Equipment restrictions:</span> {partner.equipmentRestrictions.join(", ")}</div>}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
      onSuccess: () => { setCreateOpen(false); invalidate(); toast({ title: "Partner created" }); },
      onError: (err: any) => toast({ title: "Failed to create partner", description: err.response?.data?.message || err.message, variant: "destructive" }),
    });
  };

  const handleUpdate = (form: LenderFormData) => {
    if (!editTarget) return;
    updateLender.mutate({ id: editTarget.id, data: formToPayload(form) as any }, {
      onSuccess: () => { setEditTarget(null); invalidate(); toast({ title: "Partner updated" }); },
      onError: (err: any) => toast({ title: "Failed to update partner", description: err.response?.data?.message || err.message, variant: "destructive" }),
    });
  };

  const handleDeactivate = (id: number, name: string) => {
    if (!confirm(`Deactivate "${name}"? This partner will no longer appear in matches.`)) return;
    deactivateLender.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: "Partner deactivated" }); },
      onError: () => toast({ title: "Failed to deactivate partner", variant: "destructive" }),
    });
  };

  const visible = (lenders ?? []).filter((l: any) => showInactive || l.isActive);

  const directLenders = visible.filter((l: any) => l.partnerType === "direct_lender" || !l.partnerType);
  const brokersOut = visible.filter((l: any) => l.partnerType === "broker_out");
  const brokersIn = visible.filter((l: any) => l.partnerType === "broker_in");

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Partner Management</h1>
          <p className="text-sm text-slate-500 mt-1 font-medium">Manage your network of direct lenders and syndication partners</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded" />
            Show inactive
          </label>
          {isAdmin && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#0E2A47] hover:bg-[#0c243c] text-white">
                  <Plus className="h-4 w-4 mr-1" /> Add Partner
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl">
                <DialogHeader>
                  <DialogTitle>Add Partner</DialogTitle>
                  <DialogDescription>Configure partner criteria for the matching engine</DialogDescription>
                </DialogHeader>
                <LenderForm initial={emptyForm()} onSubmit={handleCreate} loading={createLender.isPending} />
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : (
        <Tabs defaultValue="direct_lenders" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-slate-100 p-1 rounded-xl">
            <TabsTrigger value="direct_lenders" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Direct Lenders ({directLenders.length})
            </TabsTrigger>
            <TabsTrigger value="brokers_out" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Brokers Out ({brokersOut.length})
            </TabsTrigger>
            <TabsTrigger value="brokers_in" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
              Brokers In ({brokersIn.length})
            </TabsTrigger>
          </TabsList>

          {[
            { value: "direct_lenders", list: directLenders, emptyText: "No direct lenders configured" },
            { value: "brokers_out", list: brokersOut, emptyText: "No outbound broker partners configured" },
            { value: "brokers_in", list: brokersIn, emptyText: "No inbound broker partners configured" },
          ].map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="focus-visible:outline-none">
              {tab.list.length === 0 ? (
                <div className="text-center py-16 border border-dashed rounded-xl text-muted-foreground bg-slate-50/50">
                  <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">{tab.emptyText}</p>
                  {isAdmin && <p className="text-sm mt-1 text-slate-400">Click "Add Partner" to get started</p>}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {tab.list.map((partner: any) => (
                    <PartnerCard
                      key={partner.id}
                      partner={partner}
                      isAdmin={isAdmin}
                      onEdit={setEditTarget}
                      onDeactivate={handleDeactivate}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {editTarget && (
        <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit Partner</DialogTitle>
              <DialogDescription>Update criteria for {editTarget.name}</DialogDescription>
            </DialogHeader>
            <LenderForm initial={lenderToForm(editTarget)} onSubmit={handleUpdate} loading={updateLender.isPending} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}