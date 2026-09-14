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