import { getListUsersQueryKey, listUsers, useGetMe, useListUsers, type ListUsersParams } from "@workspace/api-client-react";

type Directory = Awaited<ReturnType<typeof listUsers>>;
type Options = Parameters<typeof useListUsers<Directory>>[1];

/** Disabled queries can still expose cached data or be manually refetched.
 * Keep both the request and the directory-backed UI inside the role boundary. */
export function useManagerDirectory(params?: ListUsersParams, options?: Options) {
  const { data: me } = useGetMe();
  const canReadDirectory = me?.role === "admin" || me?.role === "manager";
  const result = useListUsers<Directory>(params, {
    ...options,
    query: {
      ...options?.query,
      queryKey: getListUsersQueryKey(params),
      enabled: canReadDirectory && (options?.query?.enabled ?? true),
    },
  });
  return {
    ...result,
    canReadDirectory,
    data: canReadDirectory ? result.data : undefined,
    refetch: canReadDirectory ? result.refetch : async () => ({ ...result, data: undefined }),
  };
}
