import { useState, useRef, useEffect } from "react";
import { useParams, Link, useLocation } from "wouter";
import {
  useGetDeal, getGetDealQueryKey,
  useUpdateDeal,
  useListDealActivity,
  useListUsers,
  DealStage,
  useArchiveDeal
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, User, DollarSign, Building2, Calendar, FileText, ChevronRight, Activity, ArrowUpRight, Check, X, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
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

export default function DealDetail() {
  const { id } = useParams();
  const dealId = Number(id);
  const [, setLocation] = useLocation();

  const { data: deal, isLoading: dealLoading } = useGetDeal(dealId, { query: { queryKey: getGetDealQueryKey(dealId) } });
  const { data: activities, isLoading: activityLoading } = useListDealActivity(dealId);
  const { data: users } = useListUsers();

  const updateDeal = useUpdateDeal();
  const archiveDeal = useArchiveDeal();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    dealName: "",
    amount: "",
    approxGm: "",
    actualGm: "",
    stage: "",
    assignedTo: ""
  });

  useEffect(() => {
    if (deal && !editMode) {
      setFormData({
        dealName: deal.dealName || "",
        amount: deal.amount ? String(deal.amount) : "",
        approxGm: deal.approxGm ? String(deal.approxGm) : "",
        actualGm: deal.actualGm ? String(deal.actualGm) : "",
        stage: deal.stage || "",
        assignedTo: deal.assignedTo ? String(deal.assignedTo) : "unassigned"
      });
    }
  }, [deal, editMode]);

  const handleSave = () => {
    if (!formData.dealName) return void toast({ title: "Deal name required", variant: "destructive" });

    updateDeal.mutate({ 
      id: dealId, 
      data: {
        dealName: formData.dealName,
        amount: formData.amount ? Number(formData.amount) : undefined,
        approxGm: formData.approxGm ? Number(formData.approxGm) : undefined,
        actualGm: formData.actualGm ? Number(formData.actualGm) : undefined,
        stage: formData.stage as any,
        assignedTo: formData.assignedTo === "unassigned" ? null : Number(formData.assignedTo)
      } 
    }, {
      onSuccess: () => {
        toast({ title: "Deal saved" });
        setEditMode(false);
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      },
      onError: () => toast({ title: "Error saving deal", variant: "destructive" })
    });
  };

  const handleArchive = () => {
    if (!confirm("Are you sure you want to archive this deal?")) return;
    archiveDeal.mutate({ id: dealId }, {
      onSuccess: () => {
        toast({ title: "Deal archived" });
        setLocation("/deals");
      }
    });
  };

  if (dealLoading) {
    return (
      <div className="flex-1 p-6 space-y-6 bg-[#f8fafc]">
        <Skeleton className="h-10 w-48" />
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex-1 p-6 bg-[#f8fafc] flex flex-col items-center justify-center">
        <h2 className="text-xl font-semibold">Deal not found</h2>
        <Link href="/deals"><Button variant="link" className="mt-2">Back to Deals</Button></Link>
      </div>
    );
  }

  const assignedRep = users?.find(u => u.id === deal.assignedTo);
  const currentStage = STAGES.find(s => s.id === deal.stage)?.label || deal.stage;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] overflow-y-auto">
      <div className="flex-none px-6 py-4 border-b bg-white flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/deals">
            <Button variant="ghost" size="icon" className="h-8 w-8 -ml-2 rounded-full text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-[#0E2A47]">{deal.dealName}</h1>
              {deal.isArchived && <Badge variant="secondary" className="bg-slate-100 text-slate-700">Archived</Badge>}
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{currentStage}</Badge>
            </div>
            {deal.leadId && deal.lead && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                Linked to Lead: 
                <Link href={`/leads/${deal.leadId}`} className="text-primary hover:underline font-medium flex items-center gap-1">
                  {(deal.lead as any).firstName} {(deal.lead as any).lastName} <ArrowUpRight className="w-3 h-3" />
                </Link>
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editMode ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditMode(false)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={updateDeal.isPending}><Check className="w-4 h-4 mr-1" /> Save</Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>Edit Details</Button>
              {!deal.isArchived && <Button variant="secondary" size="sm" onClick={handleArchive}>Archive</Button>}
            </>
          )}
        </div>
      </div>

      <div className="p-6 max-w-[1200px] w-full mx-auto grid lg:grid-cols-[1fr_400px] gap-6">
        <div className="space-y-6">
          <Card className="shadow-sm border-gray-200/60 overflow-hidden">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Deal Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {editMode ? (
                <div className="grid grid-cols-2 gap-6">
                  <div className="col-span-2 space-y-2">
                    <Label>Deal Name</Label>
                    <Input value={formData.dealName} onChange={e => setFormData(f => ({...f, dealName: e.target.value}))} />
                  </div>
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
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users?.map(u => <SelectItem key={u.id} value={String(u.id)}>{u.name || u.email}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" value={formData.amount} onChange={e => setFormData(f => ({...f, amount: e.target.value}))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Expected GM</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" value={formData.approxGm} onChange={e => setFormData(f => ({...f, approxGm: e.target.value}))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Actual GM (Funded only)</Label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input type="number" className="pl-8" value={formData.actualGm} onChange={e => setFormData(f => ({...f, actualGm: e.target.value}))} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-6 gap-y-8">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Amount</div>
                    <div className="text-lg font-semibold text-[#0E2A47]">{deal.amount ? `$${deal.amount.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Expected GM</div>
                    <div className="text-lg font-semibold text-emerald-600">{deal.approxGm ? `$${deal.approxGm.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Actual GM</div>
                    <div className="text-lg font-semibold text-[#149258]">{deal.actualGm ? `$${deal.actualGm.toLocaleString()}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Assigned Rep</div>
                    <div className="text-sm font-medium flex items-center gap-2 text-gray-700">
                      <User className="h-4 w-4 text-muted-foreground" /> {assignedRep?.name || "Unassigned"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Created</div>
                    <div className="text-sm font-medium text-gray-700 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" /> {format(new Date(deal.createdAt), "MMM d, yyyy")}
                    </div>
                  </div>
                  {deal.fundedAt && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Funded At</div>
                      <div className="text-sm font-medium text-[#149258] flex items-center gap-2">
                        <Check className="h-4 w-4" /> {format(new Date(deal.fundedAt), "MMM d, yyyy")}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="shadow-sm border-gray-200/60 overflow-hidden h-full flex flex-col">
            <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4 shrink-0">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" /> Activity Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              {activityLoading ? (
                <div className="p-4 space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : activities?.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No activity yet.</div>
              ) : (
                <div className="p-6 relative">
                  <div className="absolute left-[35px] top-6 bottom-6 w-0.5 bg-gray-100" />
                  <div className="space-y-6">
                    {activities?.map(activity => {
                      const isStageChange = activity.action === "stage_changed";
                      const oldStage = STAGES.find(s => s.id === (activity.details as any)?.oldStage)?.label || (activity.details as any)?.oldStage;
                      const newStage = STAGES.find(s => s.id === (activity.details as any)?.newStage)?.label || (activity.details as any)?.newStage;
                      
                      return (
                        <div key={activity.id} className="relative flex items-start gap-4 z-10">
                          <div className={cn("h-8 w-8 rounded-full border-2 border-white flex items-center justify-center shrink-0 shadow-sm", isStageChange ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500")}>
                            {isStageChange ? <ChevronRight className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {isStageChange ? (
                                <>Moved to <span className="font-semibold text-blue-700">{newStage}</span></>
                              ) : (
                                activity.action
                              )}
                            </p>
                            {isStageChange && oldStage && (
                              <p className="text-xs text-muted-foreground mt-0.5">from {oldStage}</p>
                            )}
                            <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
                              {format(new Date(activity.createdAt), "MMM d, h:mm a")} 
                              {activity.user && <span>· by {activity.user.name || activity.user.email}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
