/**
 * The workspace packages intentionally expose TypeScript source to the API
 * server. Node's strip-types support does not resolve extensionless imports
 * in those sources, so the test loader adds the source extension only after
 * Node's normal resolver has failed.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw error;
    for (const extension of [".ts", ".js", ".mjs"]) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch {
        // Try the next source extension.
      }
    }
    for (const extension of [".ts", ".js", ".mjs"]) {
      try {
        return await nextResolve(`${specifier}/index${extension}`, context);
      } catch {
        // Try the next source index extension.
      }
    }
    throw error;
  }
}

/**
 * Node's experimental type-stripper deliberately rejects TypeScript enums.
 * The production TypeScript build handles the empty ACL enum; tests only need
 * its type position, so erase that unsupported declaration before the built-in
 * stripper evaluates the workspace source.
 */
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!url.endsWith("/src/lib/objectAcl.ts") || loaded.source == null) {
    return loaded;
  }
  const source = typeof loaded.source === "string"
    ? loaded.source
    : Buffer.from(loaded.source).toString("utf8");
  return {
    ...loaded,
    source: source.replace(
      "export enum ObjectAccessGroupType {}",
      "export type ObjectAccessGroupType = never;",
    ),
  };
}