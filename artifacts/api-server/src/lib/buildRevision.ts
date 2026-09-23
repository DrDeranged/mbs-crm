// Replaced by esbuild at build time. Direct source execution (unit tests)
// intentionally identifies itself as unbuilt rather than claiming a commit.
declare const __MBS_BUILD_REVISION__: string;
export const buildRevision = typeof __MBS_BUILD_REVISION__ === "string"
  ? __MBS_BUILD_REVISION__
  : "unbuilt";

export const REVISION_HEADER = "X-MBS-Revision";