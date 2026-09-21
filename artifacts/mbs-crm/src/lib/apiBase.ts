/** API origin for this artifact, respecting a non-root Vite base path. */
export function getApiBaseUrl(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}

/** Resolves API-returned paths without duplicating the artifact's /api prefix. */
export function resolveApiUrl(path: string, apiBase = getApiBaseUrl()): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedBase = apiBase.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const routePath = normalizedPath === "/api"
    ? ""
    : normalizedPath.startsWith("/api/")
      ? normalizedPath.slice(4)
      : normalizedPath;

  return `${normalizedBase}${routePath}`;
}
