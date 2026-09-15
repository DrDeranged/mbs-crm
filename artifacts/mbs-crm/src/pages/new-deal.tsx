import { useState } from "react";
import { getUserDisplayName } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import {
  useCreateDeal,
  useListUsers,
  useListLeads,
  DealStage,
  getListDealsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, DollarSign } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";

const STAGES = [
  { id: DealStage.waiting_on_app, label: "Waiting on App" },
  { id: DealStage.information_needed, label: "Info Needed" },
  { id: DealStage.submitted, label: "Submitted" },
  { id: DealStage.approved, label: "Approved" },
  { id: DealStage.going_to_funding, label: "Going to Funding" },
  { id: DealStage.in_funding, label: "In Funding" },
  { id: DealStage.funded, label: "Funded" },
  { id: DealStage.hold_on, label: "Hold On" },
  { id: DealStage.declined, label: "Declined" },
  { id: DealStage.dead, label: "Dead" },
];

export default function NewDeal() {
  const [, setLocation] = useLocation();
  const { data: users } = useListUsers({ role: "rep", isActive: true });
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
        assignedTo: formData.assignedTo === "unassigned" ? undefined : Number(formData.assignedTo)
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
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <div className="flex-none px-6 py-4 border-b bg-white flex items-center gap-4 sticky top-0 z-[var(--z-header)] shadow-sm">
        <Link href="/deals">
          <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 rounded-full text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-[#0E2A47]">New Deal</h1>
        </div>
      </div>

      <div className="p-6 max-w-2xl w-full mx-auto">
        <form onSubmit={handleSubmit}>
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Deal Information</CardTitle>
              <CardDescription>Enter the details for this new deal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              
              <div className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <Label>Deal name <span className="text-red-500">*</span></Label>
                    <Input
                      value={formData.dealName}
                      onChange={e => {
                        setFormData(f => ({...f, dealName: e.target.value}));
                        if (e.target.value) setErrors(prev => ({ ...prev, dealName: "" }));
                      }}
                      placeholder="e.g. Acme Corp - Equipment Financing"
                      autoFocus
                    />
                    {errors.dealName && <p className="text-[13px] text-red-500">{errors.dealName}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Associated lead (optional)</Label>
                    <Select
                      value={formData.leadId || "none"}
                      onValueChange={v => {
                        setFormData(f => ({...f, leadId: v === "none" ? "" : v}));
                        if (v) setErrors(prev => ({ ...prev, leadId: "" }));
                      }}
                    >
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Select a lead..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No associated lead</SelectItem>
                        {leads.map((l: any) => (
                          <SelectItem key={l.id} value={String(l.id)}>
                            {l.firstName} {l.lastName} {l.companyName ? `(${l.companyName})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.leadId && <p className="text-[13px] text-red-500">{errors.leadId}</p>}
                  </div>
                </div>
                
                <div className="grid sm:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <Label>Stage</Label>
                    <Select value={formData.stage} onValueChange={v => setFormData(f => ({...f, stage: v}))}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Assigned rep</Label>
                    <Select value={formData.assignedTo} onValueChange={v => setFormData(f => ({...f, assignedTo: v}))}>
                      <SelectTrigger className="bg-white"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{getUserDisplayName(u)}</SelectItem>)}
                      </SelectContent>
                    </Select>
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
