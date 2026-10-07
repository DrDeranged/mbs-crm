import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listLeads, getListLeadsQueryKey, type ListLeadsParams } from "@workspace/api-client-react";
import { mergeLeadPages, nextLeadPage } from "@/lib/leadsScroll";

export function useScrollingLeads(params: ListLeadsParams, enabled: boolean, accountId?: number, role?: string) {
  const { page: _page, ...filters } = params;
  const query = useInfiniteQuery({
    queryKey: [...getListLeadsQueryKey(filters), "desktop-scroll", accountId, role],
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => listLeads({ ...filters, page: pageParam }, { signal }),
    getNextPageParam: (last, _pages, pageParam) => nextLeadPage(pageParam, last.totalPages),
  });
  const data = useMemo(() => mergeLeadPages(query.data?.pages ?? []), [query.data]);
  return { ...query, data };
}
