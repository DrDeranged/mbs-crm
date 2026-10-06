import { useState } from "react";
import { useAssignmentDirectory as useListUsers } from "@/hooks/use-assignment-directory";
import { getUserDisplayName } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import {
  useCreateDeal,
  useListLeads,
  DealStage,
  getListDealsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, DollarSign } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { DEAL_STAGE_COLUMNS } from "@/lib/dealBoard";
import { formatLeadIdentity } from "@/lib/recordIdentity";

const STAGES = DEAL_STAGE_COLUMNS;

export default function NewDeal() {
  const [, setLocation] = useLocation();
  const { data: users, canReadDirectory } = useListUsers({ role: "rep", isActive: true });
  const { data: leadsData } = useListLeads({ limit: 100 });
  const leads = (leadsData as any)?.leads ?? [];
  
  const createDeal = useCreateDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    dealName: "",
    leadId: "",
    amount: "",
    approxGm: "",
    stage: DealStage.waiting_on_app as string,
    assignedTo: "unassigned"
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let hasError = false;
    const newErrors: Record<string, string> = {};

    if (!formData.dealName) {
      newErrors.dealName = "Deal name is required";
      hasError = true;
    }

    setErrors(newErrors);
    if (hasError) return;

    createDeal.mutate({
      data: {
        dealName: formData.dealName,
        leadId: formData.leadId ? Number(formData.leadId) : null,
        amount: formData.amount ? Number(formData.amount) : undefined,
        approxGm: formData.approxGm ? Number(formData.approxGm) : undefined,
        stage: formData.stage as any,
        assignedTo: canReadDirectory && formData.assignedTo !== "unassigned" ? Number(formData.assignedTo) : undefined
      }
    }, {
      onSuccess: (deal) => {
        toast({ title: "Deal created successfully" });
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        setLocation(`/deals/${deal.id}`);
      },
      onError: (err: any) => {
        const msg = err.response?.data?.message || err.message;
        toast({ title: "Failed to create deal", description: msg, variant: "destructive" });
        if (msg.toLowerCase().includes("name")) {
          setErrors(prev => ({ ...prev, dealName: msg }));
        }
        if (msg.toLowerCase().includes("lead")) {
          setErrors(prev => ({ ...prev, leadId: msg }));
        }
      }
    });
  };

  const isSubmitDisabled = createDeal.isPending || !formData.dealName.trim();

  return (
    <div className="flex-1 flex flex-col h-full bg-muted overflow-y-auto">
      <div className="flex-none px-6 py-4 border-b bg-card flex items-center gap-4 sticky top-0 z-[var(--z-header)] ">
        <Link href="/deals">
          <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 rounded-full text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">New Deal</h1>
        </div>
      </div>

      <div className="p-6 max-w-2xl w-full mx-auto">
        <form onSubmit={handleSubmit}>
          <Card className="">
            <CardHeader>
              <CardTitle>Deal Information</CardTitle>
              <CardDescription>Enter the details for this new deal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              
              <div className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <Label>Deal name <span className="text-danger">*</span></Label>
                    <Input
                      value={formData.dealName}
                      onChange={e => {
                        setFormData(f => ({...f, dealName: e.target.value}));
                        if (e.target.value) setErrors(prev => ({ ...prev, dealName: "" }));
                      }}
                      placeholder="e.g. Acme Corp - Equipment Financing"
                      autoFocus
                    />
                    {errors.dealName && <p className="text-[13px] text-danger">{errors.dealName}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Associated lead (optional)</Label>
                    <SearchableSelect
                      options={[
                        { value: "none", label: "No associated lead" },
                        ...leads.map((l: any) => ({
                          value: String(l.id),
                          label: formatLeadIdentity(l),
                          keywords: [l.companyName, l.firstName, l.lastName, l.email, l.phone].filter(Boolean).join(" "),
                        })),
                      ]}
                      value={formData.leadId || "none"}
                      onValueChange={value => {
                        setFormData(f => ({...f, leadId: value === "none" ? "" : value}));
                        if (value) setErrors(prev => ({ ...prev, leadId: "" }));
                      }}
                      placeholder="Select a lead..."
                      searchPlaceholder="Search leads…"
                      className="bg-card"
                    />
                    {errors.leadId && <p className="text-[13px] text-danger">{errors.leadId}</p>}
                  </div>
                </div>
                
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <Label>Stage</Label>
                    <Select value={formData.stage} onValueChange={v => setFormData(f => ({...f, stage: v}))}>
                      <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    {canReadDirectory && <><Label>Assigned rep</Label>
                    <SearchableSelect
                      options={[
                        { value: "unassigned", label: "Unassigned" },
                        ...(users ?? []).map(u => ({ value: String(u.id), label: getUserDisplayName(u) })),
                      ]}
                      value={formData.assignedTo}
                      onValueChange={value => setFormData(f => ({...f, assignedTo: value}))}
                      placeholder="Unassigned"
                      searchPlaceholder="Search reps…"
                      className="bg-card"
                    /></>}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Requested amount</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" value={formData.amount} onChange={e => setFormData(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expected GM</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" value={formData.approxGm} onChange={e => setFormData(f => ({...f, approxGm: e.target.value}))} placeholder="0.00" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t flex justify-end gap-2">
                <Link href="/deals"><Button variant="outline" type="button">Cancel</Button></Link>
                <Button type="submit" disabled={isSubmitDisabled}>
                  {createDeal.isPending ? "Creating..." : "Create Deal"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
