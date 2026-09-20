/** API origin for this artifact, respecting a non-root Vite base path. */
export function getApiBaseUrl(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}

/** Resolves API-returned paths without duplicating the artifact's /api prefix. */
export function resolveApiUrl(path: string, apiBase = getApiBaseUrl()): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/api/")
    ? path.slice("/api".length)
    : path.startsWith("/")
      ? path
      : `/${path}`;
  return `${apiBase.replace(/\/$/, "")}${normalizedPath}`;
}