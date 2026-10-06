import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getUserDisplayName } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Building2, Mail, User, Link2, Phone } from "lucide-react";
import { getGetLeadQueryKey, getListLeadActivityQueryKey, getListUsersQueryKey, useAssignLead, useCreateUsfaApplicationLink, useGetMe, useListUsers } from "@workspace/api-client-react";
import { EmailLink, PhoneLink } from "@/components/phone-link";
import { contactName, formatLeadIdentity } from "@/lib/recordIdentity";
import { useLeadDetail } from "./context";
import { ConvertToDealDialog } from "./deals";
import { EditLeadDialog } from "./edit-dialog";

export function LeadAssignmentPicker() {
  const { data: currentUser } = useGetMe();
  const { lead, id: leadId } = useLeadDetail();
  const canAssign = currentUser?.role === "manager" || currentUser?.role === "admin";
  const { data: reps } = useListUsers({ role: "rep", isActive: true }, {
    query: { queryKey: getListUsersQueryKey({ role: "rep", isActive: true }), enabled: canAssign },
  });
  const assignLead = useAssignLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  if (!canAssign || !reps) return null;

  const handleAssign = (repId: string) => {
    assignLead.mutate(
      { id: leadId, data: { repId: Number(repId) } },
      {
        onSuccess: () => {
          toast({ title: "Lead reassigned" });
          queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
        },
        onError: () => toast({
          title: "Could not reassign lead",
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <SearchableSelect
      value={lead.assignedRepId ? String(lead.assignedRepId) : ""}
      onValueChange={handleAssign}
      disabled={assignLead.isPending}
      placeholder="Assign to rep…"
      ariaLabel="Assign lead to representative"
      className="w-[190px] bg-card font-medium "
      options={reps.map((rep) => ({
        value: String(rep.id),
        label: getUserDisplayName(rep),
        detail: rep.email || undefined,
        keywords: [rep.email, rep.name].filter(Boolean).join(" "),
      }))}
    />
  );
}

export function HeaderCard() {
  const {
    lead,
    handleStatusChange,
    changeStatus,
    fundedDialogOpen,
    setFundedDialogOpen,
    fundedAmountInput,
    setFundedAmountInput,
    handleConfirmFunded,
  } = useLeadDetail();
  const { data: currentUser } = useGetMe();
  const createUsfaLink = useCreateUsfaApplicationLink();
  const { toast } = useToast();
  const canCreateUsfaLink = lead.leadSource === "usfundadvisor"
    && (currentUser?.role === "admin" || (currentUser?.role === "rep" && currentUser.id === lead.assignedRepId));
  const handleCreateUsfaLink = () => {
    createUsfaLink.mutate({ id: lead.id }, {
      onSuccess: async ({ url }) => {
        try {
          await navigator.clipboard.writeText(url);
          toast({ title: "Secure USFA link copied" });
        } catch {
          toast({ title: "Secure USFA link created", description: url });
        }
      },
      onError: () => toast({ title: "Could not create USFA link", variant: "destructive" }),
    });
  };

  return (
    <>
      <div className="border-b bg-card ">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="mb-3">
          <Link href="/leads" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Leads
          </Link>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-foreground break-words">
              {formatLeadIdentity(lead)}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{contactName(lead) || "Contact name unavailable"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {lead.phone?.trim() ? <PhoneLink phone={lead.phone.trim()} leadId={lead.id} /> : <span>Phone unavailable</span>}
              </div>
              <div className="flex min-w-0 items-center gap-1.5">
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                {lead.email?.trim() ? <EmailLink email={lead.email.trim()} leadId={lead.id} className="min-w-0 break-all" /> : <span>Email unavailable</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{lead.businessAddress?.trim() || "Business address unavailable"}</span>
              </div>
              {lead.lastActivityAt && (
                <div className="text-xs">
                  Last activity {formatDistanceToNow(new Date(lead.lastActivityAt), { addSuffix: true })} · {getUserDisplayName(lead.lastActivityActor, "System")}
                </div>
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <LeadAssignmentPicker />
            {canCreateUsfaLink && (
              <Button variant="outline" size="sm" onClick={handleCreateUsfaLink} disabled={createUsfaLink.isPending}>
                <Link2 className="mr-1.5 h-4 w-4" /> Secure application link
              </Button>
            )}
            <Select 
              value={lead.status}
              onValueChange={handleStatusChange}
              disabled={changeStatus.isPending}
            >
              <SelectTrigger className="w-[150px] sm:w-[180px] bg-card font-medium ">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new_lead">New Lead</SelectItem>
                <SelectItem value="contacted">Contacted</SelectItem>
                <SelectItem value="application_received">App Received</SelectItem>
                <SelectItem value="submitted_to_underwriting">In Underwriting</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="funded">Funded</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="follow_up">Follow Up</SelectItem>
              </SelectContent>
            </Select>
            <ConvertToDealDialog />
            <EditLeadDialog />
          </div>
        </div>
        </div>
      </div>

      <Dialog open={fundedDialogOpen} onOpenChange={setFundedDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Lead as Funded</DialogTitle>
            <DialogDescription>
              Enter the funded amount for this deal to record it in revenue reporting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="funded-amount">Funded amount ($)</Label>
            <Input
              id="funded-amount"
              type="number"
              min={1}
              step={1}
              autoFocus
              value={fundedAmountInput}
              onChange={(e) => setFundedAmountInput(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setFundedDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleConfirmFunded}
              disabled={changeStatus.isPending}
            >
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeadSummary({ sticky = true }: { sticky?: boolean } = {}) {
  const { lead } = useLeadDetail();
  return (
    <div className={sticky ? "space-y-6 lg:sticky lg:top-[160px]" : "space-y-6"}>
      <Card className="">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <User className="h-4 w-4" /> Deal Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-y-6">
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Financing Type</div>
              <div className="font-medium capitalize text-sm">{lead.applicationType.replace('_', ' ')}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Source</div>
              <div className="font-medium capitalize text-sm">{lead.leadSource}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Assigned To</div>
              <div className="font-medium text-sm flex items-center gap-2">
                {lead.assignedRep ? (
                  <>
                    <div className="h-5 w-5 rounded-full bg-info-bg text-info flex items-center justify-center text-[10px] font-bold">
                      {getUserDisplayName(lead.assignedRep).charAt(0) || 'U'}
                    </div>
                    {getUserDisplayName(lead.assignedRep)}
                  </>
                ) : 'Unassigned'}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Created</div>
              <div className="font-medium text-sm">{format(new Date(lead.createdAt), 'MMM d, yyyy')}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
