import {
  useGetMe, getGetMeQueryKey,
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useGetRepDashboard, getGetRepDashboardQueryKey,
  useGetMyTasks, getGetMyTasksQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, Clock, Calendar, ArrowRight, Activity } from "lucide-react";
import { format } from "date-fns";

const STAGE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-800",
  contacted: "bg-indigo-100 text-indigo-800",
  follow_up: "bg-yellow-100 text-yellow-800",
  application_received: "bg-orange-100 text-orange-800",
  submitted_to_underwriting: "bg-purple-100 text-purple-800",
  approved: "bg-green-100 text-green-800",
  funded: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-800",
};

function formatStageLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

export default function Dashboard() {
  const { data: currentUser, isLoading: loadingUser } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });

  const isRep = currentUser?.role === "rep";

  const { data: adminSummary, isLoading: loadingAdmin } = useGetDashboardSummary({
    query: {
      queryKey: getGetDashboardSummaryQueryKey(),
      enabled: !loadingUser && !isRep,
    },
  });

  const { data: repDashboard, isLoading: loadingRep } = useGetRepDashboard({
    query: {
      queryKey: getGetRepDashboardQueryKey(),
      enabled: !loadingUser && isRep,
    },
  });

  const { data: myTasks, isLoading: loadingTasks } = useGetMyTasks({
    query: { queryKey: getGetMyTasksQueryKey() },
  });

  const isLoading = loadingUser || (isRep ? loadingRep : loadingAdmin) || loadingTasks;

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Overview of your pipeline and tasks</p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Skeleton className="h-96 w-full rounded-xl col-span-4" />
          <Skeleton className="h-96 w-full rounded-xl col-span-3" />
        </div>
      </div>
    );
  }

  const recentLeads = isRep ? repDashboard?.myLeads : adminSummary?.recentLeads;
  const activeLeadCount = isRep
    ? repDashboard?.myLeads?.length ?? 0
    : adminSummary?.recentLeads?.length ?? 0;

  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {isRep ? "Your pipeline and tasks" : "Full team pipeline overview"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Due Today</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myTasks?.dueToday?.length ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Due This Week</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myTasks?.dueThisWeek?.length ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Overdue Tasks</CardTitle>
            <Clock className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {myTasks?.overdue?.length ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {isRep ? "My Active Leads" : "Pipeline (Recent)"}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeLeadCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>{isRep ? "My Leads" : "Recent Leads"}</CardTitle>
            <CardDescription>Recently added or updated leads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentLeads?.slice(0, 5).map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      <Link href={`/leads/${lead.id}`} className="hover:underline text-[#1F4E79]">
                        {lead.firstName} {lead.lastName}
                      </Link>
                    </p>
                    <p className="text-sm text-muted-foreground">{lead.companyName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline">{lead.status.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(lead.updatedAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                </div>
              ))}

              {!recentLeads?.length && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No recent leads found.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Tasks Priority</CardTitle>
            <CardDescription>Your upcoming and overdue tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {myTasks?.overdue?.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
                >
                  <Clock className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-destructive leading-none">{task.title}</p>
                    <div className="flex items-center gap-2 text-xs text-destructive/80">
                      <span>Overdue</span>
                      {task.dueDate && (
                        <span>• {format(new Date(task.dueDate), "MMM d, yyyy")}</span>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/leads/${task.leadId}`}
                    className="text-xs text-destructive hover:underline flex items-center"
                  >
                    Lead <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              ))}

              {myTasks?.dueToday?.map((task) => (
                <div key={task.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <CheckCircle2 className="h-5 w-5 text-[#1F4E79] mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">{task.title}</p>
                    <div className="text-xs text-muted-foreground">Due today</div>
                  </div>
                  <Link
                    href={`/leads/${task.leadId}`}
                    className="text-xs text-[#1F4E79] hover:underline flex items-center"
                  >
                    Lead <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              ))}

              {!myTasks?.overdue?.length && !myTasks?.dueToday?.length && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  You're all caught up! No urgent tasks.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manager/Admin: Pipeline stage counts */}
      {!isRep && adminSummary?.pipelineCounts && adminSummary.pipelineCounts.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Pipeline by Stage</CardTitle>
            <CardDescription>Lead count at each stage of the financing pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {adminSummary.pipelineCounts.map((item) => {
                const statusKey = item.status ?? "";
                return (
                  <div
                    key={statusKey}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 ${STAGE_COLORS[statusKey] ?? "bg-gray-100 text-gray-800"}`}
                  >
                    <span className="text-sm font-medium">{formatStageLabel(statusKey)}</span>
                    <span className="text-lg font-bold">{item.count}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manager/Admin: Leads by Rep */}
      {!isRep && adminSummary?.repCounts && adminSummary.repCounts.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Leads by Rep</CardTitle>
            <CardDescription>Total leads assigned per sales representative</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {adminSummary.repCounts.map((rep) => (
                <div key={rep.repId} className="flex items-center gap-2 rounded-lg border px-4 py-2 bg-white">
                  <div className="text-sm font-medium">{rep.repName}</div>
                  <Badge variant="secondary">{rep.count}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rep: Recent Activity Feed */}
      {isRep && repDashboard?.recentActivity && repDashboard.recentActivity.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Activity
            </CardTitle>
            <CardDescription>Your latest actions across all leads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {repDashboard.recentActivity.slice(0, 10).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 text-sm border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex-shrink-0 mt-0.5 h-6 w-6 rounded-full bg-[#1F4E79]/10 flex items-center justify-center">
                    <Activity className="h-3 w-3 text-[#1F4E79]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium capitalize">{entry.action}</p>
                    <p className="text-muted-foreground text-xs truncate">{entry.entityType} #{entry.entityId}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(entry.createdAt), "MMM d, h:mm a")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
