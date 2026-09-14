import { format } from "date-fns";
import { getUserDisplayName } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getListLeadActivityQueryKey, useListLeadActivity } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
// Activity Tab
export function LeadActivity() {
  const { id: leadId } = useLeadDetail();
  const { data: activities, isLoading } = useListLeadActivity(leadId, { query: { queryKey: getListLeadActivityQueryKey(leadId) } });

  if (isLoading) return <div className="mt-4 space-y-4"><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div>;

  return (
    <div className="space-y-6 mt-4 relative max-w-full">
      {activities?.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">No activity yet.</div>
      ) : (
        <div className="space-y-6 pl-4 border-l-2 border-gray-200 ml-2 py-2">
          {activities?.map((activity) => (
            <div key={activity.id} className="relative flex min-w-0">
              <div className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full bg-blue-500 ring-4 ring-white shrink-0" />
              <div className="space-y-1 min-w-0 flex-1">
                <p className="text-sm font-medium break-words [overflow-wrap:anywhere]">
                  {typeof activity.details?.message === "string"
                    ? activity.details.message
                    : <><span className="truncate inline-block align-bottom max-w-[120px] sm:max-w-[200px]" title={getUserDisplayName(activity.user, "System")}>{getUserDisplayName(activity.user, "System")}</span> <span className="font-normal text-muted-foreground">{activity.action}</span> {activity.entityType}</>}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={format(new Date(activity.createdAt), 'MMM d, yyyy h:mm a')}>
                  {format(new Date(activity.createdAt), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
