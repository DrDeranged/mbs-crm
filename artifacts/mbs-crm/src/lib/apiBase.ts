/** API origin for this artifact, respecting a non-root Vite base path. */
export function getApiBaseUrl(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
}