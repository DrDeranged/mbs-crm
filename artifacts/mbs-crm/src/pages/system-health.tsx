import { useState } from "react";
import { useGetMe, useGetAdminErrors, getGetAdminErrorsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Activity, CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const JOB_LABELS: Record<string, string> = {
  drip: "Drip Emails",
  "task-reminder": "Task Reminders",
  renewal: "Renewal Radar",
};

type JobRunSummary = {
  jobName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsProcessed: number;
  errorMessage: string | null;
} | null;

export default function SystemHealth() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const [page, setPage] = useState(1);

  const isAdmin = me?.role === "admin";

  const { data, isLoading } = useGetAdminErrors(
    { page },
    { query: { queryKey: getGetAdminErrorsQueryKey({ page }), enabled: isAdmin } },
  );

  if (meLoading) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[60vh]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
        <Empty>
          <EmptyMedia variant="icon">
            <ShieldAlert className="h-5 w-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Access restricted</EmptyTitle>
            <EmptyDescription>Only admins can view the System Health dashboard.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const summary = data?.summary;
  const jobs = (data?.jobs ?? {}) as Record<string, JobRunSummary>;
  const errors = data?.errors ?? [];
  const limit = data?.pagination?.limit ?? 25;

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">System Health</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Live error log and background job status.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Errors — 24h</p>
            <p className={`text-3xl font-bold ${(summary?.last24h ?? 0) > 0 ? "text-destructive" : "text-green-600"}`}>
              {isLoading ? "—" : (summary?.last24h ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Errors — 7d</p>
            <p className={`text-3xl font-bold ${(summary?.last7d ?? 0) > 0 ? "text-amber-600" : "text-green-600"}`}>
              {isLoading ? "—" : (summary?.last7d ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="pt-5 pb-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Overall</p>
            <div className="flex items-center gap-2 mt-1">
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              ) : (summary?.last24h ?? 0) === 0 ? (
                <>
                  <CheckCircle2 size={20} className="text-green-600" />
                  <span className="font-semibold text-green-700">Healthy</span>
                </>
              ) : (
                <>
                  <XCircle size={20} className="text-destructive" />
                  <span className="font-semibold text-destructive">Errors detected</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Background jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity size={16} />
            Background Jobs
          </CardTitle>
          <CardDescription>Last completed run for each background job.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(["drip", "task-reminder", "renewal"] as const).map((jobName) => {
              const run = jobs[jobName];
              return (
                <div
                  key={jobName}
                  className="flex items-center justify-between rounded-lg border px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-sm">{JOB_LABELS[jobName] ?? jobName}</p>
                    {run ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(run.finishedAt ?? run.startedAt)}
                        {" · "}
                        {run.itemsProcessed} item{run.itemsProcessed !== 1 ? "s" : ""} processed
                        {run.errorMessage && (
                          <span className="text-destructive"> · {run.errorMessage}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-0.5">Never run</p>
                    )}
                  </div>
                  {run ? (
                    <Badge variant={run.status === "success" ? "outline" : "destructive"}>
                      {run.status === "success" ? (
                        <span className="flex items-center gap-1 text-green-700">
                          <CheckCircle2 size={11} />
                          OK
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <XCircle size={11} />
                          Error
                        </span>
                      )}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Clock size={11} />
                      Pending
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Error log */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>
            500-level errors captured from the API. Give the request ID to ops to grep in logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : errors.length === 0 ? (
            <div className="py-4">
              <Empty>
                <EmptyMedia variant="icon">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No errors recorded — system healthy</EmptyTitle>
                  <EmptyDescription>
                    500-level errors will appear here when they occur.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-36">Time</TableHead>
                      <TableHead className="w-20">Status</TableHead>
                      <TableHead>Path</TableHead>
                      <TableHead className="max-w-xs">Message</TableHead>
                      <TableHead className="hidden lg:table-cell">Request ID</TableHead>
                      <TableHead className="hidden lg:table-cell">User</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errors.map((err) => (
                      <TableRow key={err.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {err.createdAt ? new Date(err.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="font-mono text-xs">
                            {err.status ?? "5xx"}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <span className="text-muted-foreground">{err.method ?? ""} </span>
                          {err.path ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-xs">
                          <p className="text-sm truncate" title={err.message ?? ""}>
                            {err.message ?? "—"}
                          </p>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {err.requestId ? `${err.requestId.slice(0, 8)}…` : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {err.userId ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">Page {page}</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft size={14} />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={errors.length < limit}
                  >
                    Next
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
