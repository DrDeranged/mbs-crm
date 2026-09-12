import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateDeal,
  useListUsers,
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
  const { data: users } = useListUsers();
  
  const createDeal = useCreateDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    dealName: "",
    amount: "",
    approxGm: "",
    stage: DealStage.waiting_on_app as string,
    assignedTo: "unassigned"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dealName) return void toast({ title: "Deal Name is required", variant: "destructive" });

    createDeal.mutate({
      data: {
        dealName: formData.dealName,
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
      onError: () => toast({ title: "Failed to create deal", variant: "destructive" })
    });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <div className="flex-none px-6 py-4 border-b bg-white flex items-center gap-4 sticky top-0 z-10 shadow-sm">
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
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Deal Name <span className="text-red-500">*</span></Label>
                <Input 
                  value={formData.dealName} 
                  onChange={e => setFormData(f => ({...f, dealName: e.target.value}))} 
                  placeholder="e.g. Acme Corp - Equipment Financing" 
                  autoFocus
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select value={formData.stage} onValueChange={v => setFormData(f => ({...f, stage: v}))}>
                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Assigned Rep</Label>
                  <Select value={formData.assignedTo} onValueChange={v => setFormData(f => ({...f, assignedTo: v}))}>
                    <SelectTrigger className="bg-white"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name || u.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Requested Amount</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="number" className="pl-8" value={formData.amount} onChange={e => setFormData(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Expected GM</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input type="number" className="pl-8" value={formData.approxGm} onChange={e => setFormData(f => ({...f, approxGm: e.target.value}))} placeholder="0.00" />
                  </div>
                </div>
              </div>
              <div className="pt-4 border-t flex justify-end gap-2">
                <Link href="/deals"><Button variant="outline" type="button">Cancel</Button></Link>
                <Button type="submit" disabled={createDeal.isPending}>
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
