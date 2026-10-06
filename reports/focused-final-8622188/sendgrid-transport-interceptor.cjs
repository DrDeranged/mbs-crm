// Preloaded into the isolated API child before its compiled entrypoint imports
// any bundled SendGrid/Axios modules. Intercepts Node transport, not sgMail.send.
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const fakeKey = "SG.FOCUSED_FAKE_KEY_NEVER_VALID";
const providerPort = Number(process.env.FOCUSED_SENDGRID_PORT);
const readyPath = process.env.FOCUSED_SENDGRID_READY_PATH;
if (!Number.isInteger(providerPort) || !readyPath) {
  throw new Error("Focused SendGrid transport interception is not configured.");
}
delete process.env.SENDGRID_INBOUND_PARSE_SECRET;
delete process.env.SENDGRID_INBOUND_PARSE_ENABLED;
process.env.SENDGRID_API_KEY = fakeKey;
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "NO_PROXY", "no_proxy"]) {
  delete process.env[key];
}

const nativeHttpRequest = http.request.bind(http);
const nativeHttpsRequest = https.request.bind(https);
function unpack(args) {
  const first = args[0];
  const callback = [...args].reverse().find((value) => typeof value === "function");
  let url, options = {};
  if (typeof first === "string" || first instanceof URL) {
    url = new URL(String(first));
    if (args[1] && typeof args[1] === "object") options = { ...args[1] };
  } else {
    options = { ...(first || {}) };
    url = new URL(`${options.protocol || "https:"}//${options.hostname || options.host || "localhost"}${options.port ? `:${options.port}` : ""}${options.path || "/"}`);
  }
  const method = String(options.method || "GET").toUpperCase();
  const host = String(options.hostname || options.host || url.hostname).replace(/:\d+$/, "").toLowerCase();
  const requestPath = String(options.path || `${url.pathname}${url.search}`).split("#")[0];
  return { callback, options, host, method, requestPath };
}
function sendgridTransport(nativeRequest, args) {
  const { callback, options, host, method, requestPath } = unpack(args);
  if (host !== "api.sendgrid.com") return null;
  if (method !== "POST" || requestPath.split("?")[0] !== "/v3/mail/send") {
    throw new Error(`Blocked non-send SendGrid transport request: ${method} ${requestPath}`);
  }
  const headers = { ...(options.headers || {}) };
  for (const key of Object.keys(headers)) if (key.toLowerCase() === "host") delete headers[key];
  headers.Host = `127.0.0.1:${providerPort}`;
  const local = {
    ...options, protocol: "http:", hostname: "127.0.0.1", host: "127.0.0.1",
    port: providerPort, path: requestPath, headers,
  };
  for (const key of ["agent", "servername", "lookup", "rejectUnauthorized", "secureContext", "cert", "key", "ca"]) delete local[key];
  fs.appendFileSync(process.env.FOCUSED_SENDGRID_TRANSPORT_LOG, `${JSON.stringify({
    event: "transport-intercepted", method, host, path: requestPath,
    destination: `http://127.0.0.1:${providerPort}`, fakeKeyInstalled: process.env.SENDGRID_API_KEY === fakeKey,
    inboundParseSecretUnset: !process.env.SENDGRID_INBOUND_PARSE_SECRET && !process.env.SENDGRID_INBOUND_PARSE_ENABLED,
  })}\n`);
  return nativeRequest(local, callback);
}
http.request = function (...args) {
  return sendgridTransport(nativeHttpRequest, args) || nativeHttpRequest(...args);
};
https.request = function (...args) {
  return sendgridTransport(nativeHttpRequest, args) || nativeHttpsRequest(...args);
};

const nativeFetch = globalThis.fetch?.bind(globalThis);
if (nativeFetch) {
  globalThis.fetch = async function (input, init = {}) {
    const original = input instanceof Request ? input : null;
    const url = new URL(original ? original.url : String(input));
    if (url.hostname.toLowerCase() !== "api.sendgrid.com") return nativeFetch(input, init);
    const method = String(init.method || original?.method || "GET").toUpperCase();
    if (method !== "POST" || url.pathname !== "/v3/mail/send") {
      throw new Error(`Blocked non-send SendGrid fetch: ${method} ${url.pathname}`);
    }
    const headers = new Headers(original?.headers || undefined);
    new Headers(init.headers || undefined).forEach((value, key) => headers.set(key, value));
    const body = init.body ?? (original ? await original.arrayBuffer() : undefined);
    return nativeFetch(`http://127.0.0.1:${providerPort}${url.pathname}${url.search}`, {
      ...init, method, headers, body, redirect: "error",
    });
  };
}
fs.writeFileSync(readyPath, `${JSON.stringify({
  ready: true, preloadedBeforeCompiledApiEntry: true, moduleBoundary: "Node HTTP/HTTPS/fetch transport",
  sendgridHost: "api.sendgrid.com", allowedMethod: "POST", allowedPath: "/v3/mail/send",
  fakeApiKeyInstalled: true, inboundParseSecretUnset: true, providerPort,
  at: new Date().toISOString(),
}, null, 2)}\n`);
