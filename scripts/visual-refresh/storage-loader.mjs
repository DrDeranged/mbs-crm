// Test-only provider adapter: keep the actual API document route/auth/DB
// transaction, but replace cloud storage with local disposable bytes.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@google-cloud/storage") {
    return { url: new URL("./storage-fixture.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}