import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, FileText, CheckSquare, File as FileIcon, MessageSquare, Clock, Building2, Megaphone, ClipboardList, BarChart3, ShieldCheck, ListChecks } from "lucide-react";
import { LeadDetailProvider, useLeadDetail } from "./lead-detail/context";
import { HeaderCard, LeadSummary } from "./lead-detail/header";
import { LeadInfo } from "./lead-detail/info";
import { LeadNotes } from "./lead-detail/notes";
import { LeadTasks } from "./lead-detail/tasks";
import { LeadDocuments } from "./lead-detail/documents";
import { LeadCommunications } from "./lead-detail/communications";
import { LeadActivity } from "./lead-detail/activity";
import { LeadLenderMatch } from "./lead-detail/matching";
import { LeadMarketing } from "./lead-detail/marketing";
import { LeadApplication } from "./lead-detail/application";
import { LeadFinancials } from "./lead-detail/financials";
import { LeadCredit } from "./lead-detail/credit";
import { LeadConsent } from "./lead-detail/consent";

function LeadDetailContent() {
  const { lead, isLoading } = useLeadDetail();

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-10 w-[200px]" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!lead) {
    return <div className="p-8 flex items-center justify-center h-full text-muted-foreground">Lead not found</div>;
  }

  return (
    <div className="flex-1 overflow-auto bg-gray-50/50">
      <HeaderCard />

      <div className="p-8 max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <LeadSummary />

        <div className="lg:col-span-2">
          <Tabs defaultValue="info" className="w-full">
            <div className="overflow-x-auto">
            <TabsList className="flex w-max min-w-full bg-white shadow-sm border p-1 gap-0.5 h-auto rounded-lg">
              <TabsTrigger value="info" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><User className="h-3.5 w-3.5 shrink-0"/> Info</TabsTrigger>
              <TabsTrigger value="notes" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileText className="h-3.5 w-3.5 shrink-0"/> Notes</TabsTrigger>
              <TabsTrigger value="tasks" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><CheckSquare className="h-3.5 w-3.5 shrink-0"/> Tasks</TabsTrigger>
              <TabsTrigger value="documents" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><FileIcon className="h-3.5 w-3.5 shrink-0"/> Docs</TabsTrigger>
              <TabsTrigger value="communications" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><MessageSquare className="h-3.5 w-3.5 shrink-0"/> Comms</TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Clock className="h-3.5 w-3.5 shrink-0"/> Activity</TabsTrigger>
              <TabsTrigger value="lenders" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Building2 className="h-3.5 w-3.5 shrink-0"/> Lenders</TabsTrigger>
              <TabsTrigger value="marketing" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><Megaphone className="h-3.5 w-3.5 shrink-0"/> Marketing</TabsTrigger>
              <TabsTrigger value="application" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ClipboardList className="h-3.5 w-3.5 shrink-0"/> App</TabsTrigger>
              <TabsTrigger value="financials" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><BarChart3 className="h-3.5 w-3.5 shrink-0"/> Financials</TabsTrigger>
              <TabsTrigger value="credit" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ShieldCheck className="h-3.5 w-3.5 shrink-0"/> Credit</TabsTrigger>
              <TabsTrigger value="consent" className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-2 text-xs data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"><ListChecks className="h-3.5 w-3.5 shrink-0"/> Consent</TabsTrigger>
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
              <LeadDocuments />
            </TabsContent>
            <TabsContent value="communications" className="outline-none">
              <LeadCommunications />
            </TabsContent>
            <TabsContent value="activity" className="outline-none">
              <LeadActivity />
            </TabsContent>
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
        </div>
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