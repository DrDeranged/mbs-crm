const FAILED_IMPORT = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk .* failed|failed to load module script/i;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error === "string") return FAILED_IMPORT.test(error);
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: string; message?: string };
  return FAILED_IMPORT.test(`${value.name ?? ""} ${value.message ?? ""}`);
}

export function reloadOnceForChunkError(
  error: unknown,
  buildId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
  reload: () => void,
): boolean {
  if (!isChunkLoadError(error)) return false;
  const key = `mbs-chunk-reload:${buildId || "unversioned"}`;
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
  } catch {
    // Without a persistent guard a broken chunk could cause an infinite reload.
    return false;
  }
  reload();
  return true;
}