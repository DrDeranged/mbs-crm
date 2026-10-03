// The release build is independent of Metro's development-preview hostname.
// An explicit public domain may override the product's production default.
function resolveDeploymentDomain(env) {
  const domain = (env.EXPO_PUBLIC_DOMAIN || "app.my-business-solutions.com").trim();
  const url = new URL(/^https?:\/\//i.test(domain) ? domain : `https://${domain}`);
  if (url.username || url.password || !url.hostname || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("EXPO_PUBLIC_DOMAIN must be a hostname, not a URL with credentials, path, query, or fragment");
  }
  return url.host;
}

module.exports = { resolveDeploymentDomain };