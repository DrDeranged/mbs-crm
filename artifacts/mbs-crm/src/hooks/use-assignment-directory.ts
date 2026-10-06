import { useManagerDirectory } from "./use-manager-directory";
import { assignmentOptions } from "@/lib/assignmentOptions";

/** Assignment pickers share eligibility without changing administrative user tables. */
export function useAssignmentDirectory(
  _params?: Parameters<typeof useManagerDirectory>[0],
  options?: Parameters<typeof useManagerDirectory>[1],
) {
  const result = useManagerDirectory({ isActive: true }, options);
  return {
    ...result,
    data: result.data ? assignmentOptions(result.data) : undefined,
  };
}
