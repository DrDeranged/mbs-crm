import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useListDeals, getListDealsQueryKey,
  useUpdateDeal,
  useSeedDeals,
  useGetMe,
  DealStage,
  Deal,
  useListUsers,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, LayoutGrid, List, Plus, DollarSign, Building2, User as UserIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const STAGES = [
  { id: DealStage.waiting_on_app, label: "Waiting on App", color: "bg-gray-100 text-gray-700" },
  { id: DealStage.information_needed, label: "Info Needed", color: "bg-orange-100 text-orange-700" },
  { id: DealStage.submitted, label: "Submitted", color: "bg-blue-100 text-blue-700" },
  { id: DealStage.approved, label: "Approved", color: "bg-green-100 text-green-700" },
  { id: DealStage.going_to_funding, label: "Going to Funding", color: "bg-teal-100 text-teal-700" },
  { id: DealStage.in_funding, label: "In Funding", color: "bg-indigo-100 text-indigo-700" },
  { id: DealStage.funded, label: "Funded", color: "bg-[#17A567]/10 text-[#149258]" },
  { id: DealStage.hold_on, label: "Hold On", color: "bg-yellow-100 text-yellow-700" },
  { id: DealStage.declined, label: "Declined", color: "bg-red-100 text-red-700" },
  { id: DealStage.dead, label: "Dead", color: "bg-slate-100 text-slate-700" },
];

function formatCurrency(val?: number | null) {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

export default function DealsPage() {
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  
  const { data: currentUser } = useGetMe();
  const isRep = currentUser?.role === "rep";

  const { data: response, isLoading } = useListDeals();
  const deals = response?.deals || [];

  const { data: users } = useListUsers();

  const updateDeal = useUpdateDeal();
  const seedDeals = useSeedDeals();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [draggedDeal, setDraggedDeal] = useState<Deal | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  
  const [fundPromptOpen, setFundPromptOpen] = useState(false);
  const [pendingFundDeal, setPendingFundDeal] = useState<Deal | null>(null);
  const [actualGm, setActualGm] = useState("");

  const filteredDeals = useMemo(() => {
    return deals.filter(d => 
      d.dealName.toLowerCase().includes(search.toLowerCase())
    );
  }, [deals, search]);

  const handleDragStart = (e: React.DragEvent, deal: Deal) => {
    setDraggedDeal(deal);
    e.dataTransfer.setData("text/plain", deal.id.toString());
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stage) setDragOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (!draggedDeal || draggedDeal.stage === stage) return;
    
    if (stage === DealStage.funded) {
      setPendingFundDeal(draggedDeal);
      setActualGm(draggedDeal.approxGm ? String(draggedDeal.approxGm) : "");
      setFundPromptOpen(true);
    } else {
      mutateDealStage(draggedDeal.id, stage);
    }
  };

  const mutateDealStage = (dealId: number, stage: string, gm?: number) => {
    updateDeal.mutate({ id: dealId, data: { stage: stage as any, ...(gm != null ? { actualGm: gm } : {}) } }, {
      onSuccess: () => {
        toast({ title: "Deal updated" });
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
      },
      onError: () => toast({ title: "Update failed", variant: "destructive" })
    });
  };

  const confirmFund = () => {
    if (!pendingFundDeal) return;
    mutateDealStage(pendingFundDeal.id, DealStage.funded, Number(actualGm));
    setFundPromptOpen(false);
    setPendingFundDeal(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc]">
      <div className="flex-none px-6 py-4 border-b bg-white flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-[#0E2A47]">Deals</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your funding pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          {currentUser?.role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              disabled={seedDeals.isPending}
              data-testid="button-seed-deals"
              onClick={() => seedDeals.mutate(undefined, {
                onSuccess: (result) => {
                  queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
                  toast({ title: "Pipeline ready", description: `${result.created} deals created; ${result.existing} already existed.` });
                },
                onError: () => toast({ title: "Pipeline seed failed", variant: "destructive" }),
              })}
            >
              {seedDeals.isPending ? "Loading pipeline…" : "Load real pipeline"}
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search deals..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
              className="pl-9 w-64 h-9 bg-gray-50 border-gray-200"
            />
          </div>
          <div className="flex border rounded-md overflow-hidden bg-gray-50 p-0.5">
            <button 
              onClick={() => setView("kanban")} 
              className={cn("px-2 py-1 rounded text-sm flex items-center gap-1", view === "kanban" ? "bg-white shadow-sm text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <LayoutGrid className="w-4 h-4" /> Kanban
            </button>
            <button 
              onClick={() => setView("table")} 
              className={cn("px-2 py-1 rounded text-sm flex items-center gap-1", view === "table" ? "bg-white shadow-sm text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <List className="w-4 h-4" /> Table
            </button>
          </div>
          <Link href="/deals/new">
            <Button size="sm" className="h-9"><Plus className="w-4 h-4 mr-1" /> New Deal</Button>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {isLoading ? (
          <div className="p-6 grid grid-cols-4 gap-6 h-full">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-full rounded-xl" />)}
          </div>
        ) : view === "kanban" ? (
          <div className="h-full overflow-x-auto overflow-y-hidden p-6">
            <div className="flex gap-4 h-full min-w-max pb-4">
              {STAGES.map(stage => {
                const stageDeals = filteredDeals.filter(d => d.stage === stage.id);
                return (
                  <div 
                    key={stage.id} 
                    className={cn(
                      "flex flex-col w-72 bg-gray-100/50 rounded-xl border border-gray-200/60 transition-colors h-full",
                      dragOverStage === stage.id ? "bg-blue-50 border-blue-200" : ""
                    )}
                    onDragOver={e => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={e => handleDrop(e, stage.id)}
                  >
                    <div className="p-3 border-b border-gray-200/60 flex items-center justify-between bg-gray-50/50 rounded-t-xl shrink-0">
                      <h3 className="font-semibold text-sm text-gray-700">{stage.label}</h3>
                      <Badge variant="secondary" className="bg-white">{stageDeals.length}</Badge>
                    </div>
                    <div className="p-2 space-y-2 overflow-y-auto flex-1 custom-scrollbar">
                      {stageDeals.map(deal => {
                        const rep = users?.find(u => u.id === deal.assignedTo);
                        return (
                          <div 
                            key={deal.id}
                            draggable
                            onDragStart={e => handleDragStart(e, deal)}
                            className="bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing group relative overflow-hidden"
                          >
                            <Link href={`/deals/${deal.id}`} className="absolute inset-0 z-0" />
                            <div className="relative z-10 pointer-events-none">
                              <h4 className="font-semibold text-sm text-[#0E2A47] truncate">{deal.dealName}</h4>
                              <div className="mt-2 space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground flex items-center"><DollarSign className="w-3 h-3 mr-0.5" /> Amount</span>
                                  <span className="font-medium text-gray-700">{formatCurrency(deal.amount)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground flex items-center"><Building2 className="w-3 h-3 mr-0.5" /> GM</span>
                                  <span className="font-medium text-emerald-600">{formatCurrency(deal.actualGm || deal.approxGm)}</span>
                                </div>
                              </div>
                              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <UserIcon className="w-3 h-3" />
                                  <span className="truncate max-w-[100px]">{rep?.name || "Unassigned"}</span>
                                </div>
                                {deal.isArchived && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">Archived</Badge>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-6 h-full overflow-auto">
            <div className="bg-white border rounded-xl shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal Name</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Expected GM</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeals.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                        No deals found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDeals.map(deal => {
                      const rep = users?.find(u => u.id === deal.assignedTo);
                      const stageObj = STAGES.find(s => s.id === deal.stage);
                      return (
                        <TableRow key={deal.id}>
                          <TableCell className="font-medium">
                            <Link href={`/deals/${deal.id}`} className="text-primary hover:underline">
                              {deal.dealName}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className={cn("px-2 py-1 rounded-full text-xs font-medium", stageObj?.color)}>
                              {stageObj?.label || deal.stage}
                            </span>
                          </TableCell>
                          <TableCell>{formatCurrency(deal.amount)}</TableCell>
                          <TableCell>{formatCurrency(deal.actualGm || deal.approxGm)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <UserIcon className="w-3.5 h-3.5" />
                              {rep?.name || "Unassigned"}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(deal.createdAt), "MMM d, yyyy")}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      <Dialog open={fundPromptOpen} onOpenChange={setFundPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Funding</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">You are moving <strong>{pendingFundDeal?.dealName}</strong> to Funded. Please verify the final Gross Margin (GM) before proceeding.</p>
            <div className="space-y-2">
              <Label>Actual GM ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="number" className="pl-8" value={actualGm} onChange={e => setActualGm(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFundPromptOpen(false)}>Cancel</Button>
            <Button onClick={confirmFund} disabled={!actualGm || updateDeal.isPending}>
              {updateDeal.isPending ? "Saving..." : "Mark as Funded"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
