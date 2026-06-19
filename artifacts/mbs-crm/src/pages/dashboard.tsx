import { useGetDashboardSummary, useGetRepDashboard, useGetMyTasks, getGetDashboardSummaryQueryKey, getGetRepDashboardQueryKey, getGetMyTasksQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, Clock, Calendar, ArrowRight } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: adminSummary, isLoading: loadingAdmin } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: repDashboard, isLoading: loadingRep } = useGetRepDashboard({ query: { queryKey: getGetRepDashboardQueryKey() } });
  const { data: myTasks, isLoading: loadingTasks } = useGetMyTasks({ query: { queryKey: getGetMyTasksQueryKey() } });

  const isLoading = loadingAdmin || loadingRep || loadingTasks;

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

  // Use rep dashboard if they have it, otherwise admin
  const isRep = !!repDashboard;
  
  return (
    <div className="flex-1 overflow-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of your pipeline and tasks</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Due Today</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myTasks?.dueToday?.length || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks Due This Week</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myTasks?.dueThisWeek?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-destructive">Overdue Tasks</CardTitle>
            <Clock className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{myTasks?.overdue?.length || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Active Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isRep ? repDashboard?.myLeads?.length || 0 : adminSummary?.recentLeads?.length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Recent Leads</CardTitle>
            <CardDescription>Recently added or updated leads</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(isRep ? repDashboard?.myLeads : adminSummary?.recentLeads)?.slice(0, 5).map(lead => (
                <div key={lead.id} className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      <Link href={`/leads/${lead.id}`} className="hover:underline text-blue-600">
                        {lead.firstName} {lead.lastName}
                      </Link>
                    </p>
                    <p className="text-sm text-muted-foreground">{lead.companyName}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline">{lead.status.replace(/_/g, ' ')}</Badge>
                    <span className="text-xs text-muted-foreground">{format(new Date(lead.updatedAt), 'MMM d, h:mm a')}</span>
                  </div>
                </div>
              ))}
              
              {!(isRep ? repDashboard?.myLeads : adminSummary?.recentLeads)?.length && (
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
              {myTasks?.overdue?.map(task => (
                <div key={task.id} className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <Clock className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium text-destructive leading-none">{task.title}</p>
                    <div className="flex items-center gap-2 text-xs text-destructive/80">
                      <span>Overdue</span>
                      {task.dueDate && <span>• {format(new Date(task.dueDate), 'MMM d, yyyy')}</span>}
                    </div>
                  </div>
                  <Link href={`/leads/${task.leadId}`} className="text-xs text-destructive hover:underline flex items-center">
                    Lead <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              ))}

              {myTasks?.dueToday?.map(task => (
                <div key={task.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <CheckCircle2 className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium leading-none">{task.title}</p>
                    <div className="text-xs text-muted-foreground">Due today</div>
                  </div>
                  <Link href={`/leads/${task.leadId}`} className="text-xs text-blue-600 hover:underline flex items-center">
                    Lead <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              ))}

              {(!myTasks?.overdue?.length && !myTasks?.dueToday?.length) && (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  You're all caught up! No urgent tasks.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
