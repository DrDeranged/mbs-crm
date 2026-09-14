import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getGetLeadQueryKey, getListDealsQueryKey, useConvertLeadToDeal, useListDeals } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
export function ConvertToDealDialog() {
  const [open, setOpen] = useState(false);
  const convert = useConvertLeadToDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { lead } = useLeadDetail();

  const [formData, setFormData] = useState({
    dealName: `${lead.firstName || ''} ${lead.lastName || ''} - ${lead.companyName || 'Deal'}`.trim(),
    amount: lead.requestedAmount ? String(lead.requestedAmount) : "",
    approxGm: ""
  });

  const handleConvert = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.dealName) return void toast({ title: "Deal name required", variant: "destructive" });

    convert.mutate({
      id: lead.id,
      data: {
        dealName: formData.dealName,
        amount: formData.amount ? Number(formData.amount) : undefined,
        approxGm: formData.approxGm ? Number(formData.approxGm) : undefined,
      }
    }, {
      onSuccess: (deal) => {
        toast({ title: "Deal created!" });
        setOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(lead.id) });
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() }); // or window.location
        setLocation(`/deals/${deal.id}`);
      },
      onError: () => toast({ title: "Failed to convert", variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="shadow-sm">Convert to Deal</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to Deal</DialogTitle>
          <DialogDescription>
            This will create a Deal linked to {lead.firstName} {lead.lastName} and keep the Lead intact.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleConvert} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Deal Name</Label>
            <Input value={formData.dealName} onChange={e => setFormData(f => ({...f, dealName: e.target.value}))} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Deal Amount</Label>
            <Input type="number" value={formData.amount} onChange={e => setFormData(f => ({...f, amount: e.target.value}))} placeholder="0.00" />
          </div>
          <div className="space-y-2">
            <Label>Expected GM</Label>
            <Input type="number" value={formData.approxGm} onChange={e => setFormData(f => ({...f, approxGm: e.target.value}))} placeholder="0.00" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={convert.isPending}>{convert.isPending ? "Creating..." : "Create Deal"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadDeals() {
  const { id: leadId } = useLeadDetail();
  const { data: response, isLoading } = useListDeals({ lead_id: leadId });
  const deals = response?.deals || [];

  return (
    <Card className="shadow-sm mt-6">
      <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Related Deals</CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : deals.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">No deals linked to this lead.</div>
        ) : (
          deals.map(deal => (
            <Link key={deal.id} href={`/deals/${deal.id}`} className="block border rounded-lg p-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-medium text-[#0E2A47]">{deal.dealName}</span>
                <span className="text-sm text-[#149258] font-semibold">{deal.amount ? `${deal.amount.toLocaleString()}` : "—"}</span>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">{deal.stage.replace(/_/g, ' ')}</Badge>
                <span>Created {new Date(deal.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
