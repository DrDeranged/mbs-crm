import { useQuery } from "@tanstack/react-query";
import type { Task } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBase";
import type { TaskFilter } from "@/lib/complianceControls";

export const getTasksListQueryKey = (filter: TaskFilter) => ["/api/tasks", { filter }] as const;

export function useTasksList(filter: TaskFilter) {
  return useQuery<Task[]>({
    queryKey: getTasksListQueryKey(filter),
    queryFn: async () => {
      const res = await fetch(`${getApiBaseUrl()}/tasks?filter=${filter}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Could not load tasks (${res.status})`);
      }
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
