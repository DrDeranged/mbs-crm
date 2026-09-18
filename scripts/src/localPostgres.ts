import path from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Rejects every remote PostgreSQL URL before it can reach a database command. */
export function assertLocalPostgresUrl(connectionString: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("A valid local PostgreSQL URL is required");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      !LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Refusing non-local PostgreSQL URL");
  }
  return url;
}

export function localPostgresUrl(port: number, database = "production_clone"): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local PostgreSQL port");
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error("Invalid local PostgreSQL database name");
  return `postgresql://postgres@127.0.0.1:${port}/${database}`;
}

export function managedPath(candidate: string, root: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Refusing PostgreSQL path outside the managed clone directory");
  }
  return resolved;
}