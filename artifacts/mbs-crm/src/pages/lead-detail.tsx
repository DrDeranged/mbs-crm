import { useContext, useEffect, useState } from "react";
import { DetailLoadError } from "@/components/detail-load-error";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, FileText, CheckSquare, File as FileIcon, MessageSquare, Clock, Building2, Megaphone, ClipboardList, BarChart3, ShieldCheck, ListChecks } from "lucide-react";
import { LeadDetailProvider, useLeadDetail } from "./lead-detail/context";
import { HeaderCard, LeadSummary } from "./lead-detail/header";
import { LeadInfo } from "./lead-detail/info";
import { LeadNotes } from "./lead-detail/notes";
import { LeadTasks } from "./lead-detail/tasks";
import { LeadDocuments } from "./lead-detail/documents";
import { LenderSubmissionsPanel } from "@/components/lender-submissions-panel";
import { LeadCommunications } from "./lead-detail/communications";
import { LeadActivity } from "./lead-detail/activity";
import { LeadLenderMatch } from "./lead-detail/matching";
import { LeadMarketing } from "./lead-detail/marketing";
import { LeadApplication } from "./lead-detail/application";
import { LeadFinancials } from "./lead-detail/financials";
import { LeadCredit } from "./lead-detail/credit";
import { LeadConsent } from "./lead-detail/consent";
import { getQueryErrorStatus } from "@/lib/query-error";
import { SoftphoneContext } from "@/components/softphone-context";
import { RecordActionBar, type RecordActionItem } from "@/components/record-action-bar";
import { leadActionTab, type LeadDetailTab } from "@/lib/recordActions";
import { isMobileWeb, phoneActionForDevice } from "@/lib/recordContact";
import { LeadDetailSkeleton } from "@/components/page-skeletons";
import { useMediaQuery } from "@/hooks/use-desktop-sidebar";

function LeadDetailContent() {
  const {
    lead,
    isLoading,
    error,
    isAdmin,
    retry,
  } = useLeadDetail();
  const {
    pendingTextLeadId,
    openTextComposer,
    clearTextComposer,
    pendingEmailLeadId,
    openEmailComposer,
    clearEmailComposer,
    softphoneAvailable,
    dial,
  } = useContext(SoftphoneContext);
  const { requestAction } = useLeadDetail();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [selectedTab, setSelectedTab] = useState<LeadDetailTab>("info");

  useEffect(() => {
    if (pendingTextLeadId && pendingTextLeadId === lead?.id) {
      setSelectedTab("communications");
    } else if (pendingTextLeadId && lead && pendingTextLeadId !== lead.id) {
      clearTextComposer();
    }
  }, [pendingTextLeadId, lead?.id, clearTextComposer]);

  useEffect(() => {
    if (!lead || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedEmail = params.get("compose") === "email";
    const pendingForLead = pendingEmailLeadId === lead.id;
    if (requestedEmail || pendingForLead) setSelectedTab("communications");
    if (requestedEmail) {
      if (!pendingForLead) openEmailComposer(lead.id);
      params.delete("compose");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    } else if (pendingEmailLeadId && !pendingForLead) {
      clearEmailComposer();
    }
  }, [lead, pendingEmailLeadId, openEmailComposer, clearEmailComposer]);

  if (isLoading) {
    return <LeadDetailSkeleton />;
  }

  if (getQueryErrorStatus(error) === 404) {
    return <div className="p-8 flex items-center justify-center h-full text-muted-foreground">Lead not found</div>;
  }

  if (error || !lead) {
    return (
      <DetailLoadError
        entity="lead"
        error={error}
        isAdmin={isAdmin}
        onRetry={retry}
      />
    );
  }

  const requestTabAction = (action: "upload" | "edit" | "note" | "task") => {
    setSelectedTab(leadActionTab(action, selectedTab));
    requestAction(action);
  };
  const actions: RecordActionItem[] = [
    { action: "upload", onClick: () => requestTabAction("upload") },
    { action: "edit", onClick: () => requestTabAction("edit") },
    {
      action: "call",
      disabled: !lead.phone?.trim(),
      disabledReason: "Phone number unavailable.",
      onClick: () => {
        const phone = lead.phone?.trim();
        if (!phone) return;
        if (phoneActionForDevice(isMobileWeb({
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
          viewportWidth: window.innerWidth,
          pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
        }), softphoneAvailable) === "softphone") dial(phone, { autoCall: true, leadId: lead.id });
        else window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
      },
    },
    {
      action: "text",
      disabled: !lead.phone?.trim(),
      disabledReason: "Phone number unavailable.",
      onClick: () => {
        openTextComposer(lead.id);
        setSelectedTab("communications");
      },
    },
    {
      action: "email",
      disabled: !lead.email?.trim(),
      disabledReason: "Email address unavailable.",
      onClick: () => {
        openEmailComposer(lead.id);
        setSelectedTab("communications");
      },
    },
    { action: "note", onClick: () => requestTabAction("note") },
    { action: "task", onClick: () => requestTabAction("task") },
  ];

  const leadTabs = (
<Tabs value={wide && selectedTab === "activity" ? "info" : selectedTab} onValueChange={(tab) => setSelectedTab(tab as LeadDetailTab)} className="w-full">
            <div className="overflow-x-auto">
            <TabsList className="record-detail-tabs flex w-max min-w-full bg-card border p-1 gap-0.5 h-auto rounded-lg">
              <TabsTrigger value="info" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><User className="h-3.5 w-3.5 shrink-0"/> Info</TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><FileText className="h-3.5 w-3.5 shrink-0"/> Notes</TabsTrigger>
              <TabsTrigger value="tasks" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><CheckSquare className="h-3.5 w-3.5 shrink-0"/> Tasks</TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><FileIcon className="h-3.5 w-3.5 shrink-0"/> Docs</TabsTrigger>
              <TabsTrigger value="communications" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><MessageSquare className="h-3.5 w-3.5 shrink-0"/> Comms</TabsTrigger>
              {!wide && <TabsTrigger value="activity" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><Clock className="h-3.5 w-3.5 shrink-0"/> Activity</TabsTrigger>}
              <TabsTrigger value="lenders" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><Building2 className="h-3.5 w-3.5 shrink-0"/> Lenders</TabsTrigger>
              <TabsTrigger value="marketing" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><Megaphone className="h-3.5 w-3.5 shrink-0"/> Marketing</TabsTrigger>
              <TabsTrigger value="application" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><ClipboardList className="h-3.5 w-3.5 shrink-0"/> App</TabsTrigger>
              <TabsTrigger value="financials" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><BarChart3 className="h-3.5 w-3.5 shrink-0"/> Financials</TabsTrigger>
              <TabsTrigger value="credit" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><ShieldCheck className="h-3.5 w-3.5 shrink-0"/> Credit</TabsTrigger>
              <TabsTrigger value="consent" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-info-bg data-[state=active]:text-info"><ListChecks className="h-3.5 w-3.5 shrink-0"/> Consent</TabsTrigger>
            </TabsList>
          </div>
            <TabsContent value="info" className="outline-none">
              <LeadInfo />
            </TabsContent>
            <TabsContent value="notes" className="outline-none">
              <LeadNotes />
            </TabsContent>
            <TabsContent value="tasks" className="outline-none">
              <LeadTasks />
            </TabsContent>
            <TabsContent value="documents" className="outline-none">
              <LenderSubmissionsPanel leadId={lead.id} />
              <LeadDocuments />
            </TabsContent>
            <TabsContent value="communications" className="outline-none">
              <LeadCommunications />
            </TabsContent>
            {!wide && <TabsContent value="activity" className="outline-none">
              <LeadActivity />
            </TabsContent>}
            <TabsContent value="lenders" className="outline-none">
              <LeadLenderMatch />
            </TabsContent>
            <TabsContent value="marketing" className="outline-none">
              <LeadMarketing />
            </TabsContent>
            <TabsContent value="application" className="outline-none">
              <LeadApplication />
            </TabsContent>
            <TabsContent value="financials" className="outline-none">
              <LeadFinancials />
            </TabsContent>
            <TabsContent value="credit" className="outline-none">
              <LeadCredit />
            </TabsContent>
            <TabsContent value="consent" className="outline-none">
              <LeadConsent />
            </TabsContent>
          </Tabs>
  );

  return (
    <div className={wide ? "flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-muted" : "h-full flex-1 overflow-auto bg-muted"}>
      <RecordActionBar items={actions} />
      <HeaderCard />

      <div className={wide ? "lead-detail-columns min-h-0 flex-1 p-6 pb-28" : "p-4 pb-28 md:p-8 md:pb-28 max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 items-start"}>
        {wide ? <div className="min-w-0 space-y-6 pr-1" data-testid="lead-detail-left"><LeadSummary sticky={false} />{leadTabs}</div> : (<>
        <LeadSummary />
        <div className="lg:col-span-2">{leadTabs}</div></>)}
        {wide && (
          <section aria-label="Activity timeline" className="min-w-0 rounded-lg border bg-card p-4" data-testid="lead-detail-activity">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Clock className="h-4 w-4" /> Activity</h2>
            <LeadActivity />
          </section>
        )}
      </div>
    </div>
  );
}

export default function LeadDetail() {
  return (
    <LeadDetailProvider>
      <LeadDetailContent />
    </LeadDetailProvider>
  );
}