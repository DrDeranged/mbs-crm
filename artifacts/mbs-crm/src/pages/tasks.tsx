import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { CalendarClock, ClipboardList, RefreshCw, UserRound } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QueryErrorState } from "@/components/query-error-state";
import { RowsSkeleton } from "@/components/page-skeletons";
import { useTasksList } from "@/hooks/use-tasks-list";
import { TASK_FILTERS, parseTaskFilter, taskDueDateLabel, type TaskFilter } from "@/lib/complianceControls";
import { getUserDisplayName, cn } from "@/lib/utils";

const EMPTY_COPY: Record<TaskFilter, string> = {
  overdue: "Nothing overdue. The queue is clear.",
  today: "No open tasks due today.",
  upcoming: "No upcoming tasks scheduled.",
  all: "No open tasks.",
};

function dueLabel(due?: string | null) {
  return { text: taskDueDateLabel(due), rel: due ? "Eastern calendar date" : "" };
}

export default function TasksPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<TaskFilter>(() => parseTaskFilter(search));
  useEffect(() => { setFilter(parseTaskFilter(search)); }, [search]);
  const { data: me } = useGetMe();
  const teamView = me?.role === "admin" || me?.role === "manager";
  const { data, isLoading, error, refetch, isFetching } = useTasksList(filter);

  const choose = (f: TaskFilter) => { setFilter(f); setLocation(`/tasks?filter=${f}`, { replace: true }); };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 md:py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><ClipboardList className="h-6 w-6 text-info" /> Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{teamView ? "Open tasks across the team" : "Open tasks on your leads"} · Eastern Time</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching} data-testid="button-refresh-tasks" className="self-start sm:self-auto">
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto rounded-lg border bg-card p-1">
        {TASK_FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            data-testid={`tab-tasks-${f.value}`}
            onClick={() => choose(f.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              filter === f.value ? (f.value === "overdue" ? "bg-danger-bg text-danger" : "bg-primary/10 text-foreground") : "text-muted-foreground hover:bg-muted",
            )}
          >
            {f.label}{filter === f.value && data ? ` (${data.length})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <QueryErrorState label="Tasks" error={error} onRetry={() => { void refetch(); }} testId="status-tasks-error" />
      ) : isLoading ? (
        <RowsSkeleton rows={5} />
      ) : !data?.length ? (
        <div className="rounded-xl border border-dashed bg-card px-6 py-12 text-center" data-testid="text-tasks-empty">
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="font-medium">{EMPTY_COPY[filter]}</p>
          {filter !== "all" && <Button variant="link" size="sm" onClick={() => choose("all")}>View all open tasks</Button>}
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((task) => {
            const due = dueLabel(task.dueDate);
            const overdue = filter === "overdue" || (task.dueDate ? new Date(task.dueDate).getTime() < Date.now() : false);
            return (
              <li key={task.id} data-testid={`row-task-${task.id}`} className={cn("rounded-lg border bg-card p-3 sm:p-4", overdue && "border-l-4 border-l-danger")}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{task.title}</p>
                    {task.description && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{task.description}</p>}
                    <Link href={`/leads/${task.leadId}`} className="mt-1 inline-block text-sm font-medium text-info hover:underline" data-testid={`link-task-lead-${task.id}`}>
                      {task.leadLabel || `Lead #${task.leadId}`}
                    </Link>
                  </div>
                  <div className="flex flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end sm:text-right">
                    <Badge variant="outline" className={overdue ? "border-danger/30 bg-danger-bg text-danger" : ""}>{due.text}</Badge>
                    {due.rel && <span className={cn("text-xs", overdue ? "text-danger" : "text-muted-foreground")}>{due.rel}</span>}
                    <span className="flex items-center gap-1 text-xs text-muted-foreground"><UserRound className="h-3 w-3" />{getUserDisplayName(task.assignedUser as any, "Unassigned")}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
