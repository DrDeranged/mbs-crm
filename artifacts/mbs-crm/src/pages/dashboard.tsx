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
import { Users, CheckCircle2, Clock, Calendar, ArrowRight } from "lucide-react";
import { format } from "date-fns";

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
    </div>
  );
}
