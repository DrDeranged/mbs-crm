/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const MANIFEST_PATHS = Object.freeze({
  android: path.join(STATIC_ROOT, "android", "manifest.json"),
  ios: path.join(STATIC_ROOT, "ios", "manifest.json"),
});
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function writeResponse(req, res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(req, platform, res) {
  if (platform !== "ios" && platform !== "android") {
    writeResponse(req, res, 400, { "content-type": "application/json" }, JSON.stringify({ error: "Invalid platform" }));
    return;
  }
  const manifestPath = MANIFEST_PATHS[platform];

  if (!fs.existsSync(manifestPath)) {
    writeResponse(
      req,
      res,
      404,
      { "content-type": "application/json" },
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  writeResponse(
    req,
    res,
    200,
    {
      "content-type": "application/json",
      "expo-protocol-version": "1",
      "expo-sfv-version": "0",
    },
    manifest,
  );
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  writeResponse(req, res, 200, { "content-type": "text/html; charset=utf-8" }, html);
}

function resolveStaticFile(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return { status: 400, filePath: null };
  }
  if (decodedPath.includes("\0")) {
    return { status: 400, filePath: null };
  }

  const root = path.resolve(STATIC_ROOT);
  const filePath = path.resolve(root, `.${decodedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return { status: 403, filePath: null };
  }
  return { status: 200, filePath };
}

function serveStaticFile(req, urlPath, res) {
  const resolved = resolveStaticFile(urlPath);
  if (!resolved.filePath) {
    writeResponse(req, res, resolved.status, {}, resolved.status === 400 ? "Bad Request" : "Forbidden");
    return;
  }
  const filePath = resolved.filePath;

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    writeResponse(req, res, 404, {}, "Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  writeResponse(req, res, 200, { "content-type": contentType }, content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

function createServer() {
  return http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch {
    writeResponse(req, res, 400, {}, "Bad Request");
    return;
  }
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/status") {
    writeResponse(req, res, 200, { "content-type": "application/json" }, JSON.stringify({ status: "ok" }));
    return;
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(req, platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(req, pathname, res);
  });
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || "3000", 10);
  createServer().listen(port, "0.0.0.0", () => {
    console.log(`Serving static Expo build on port ${port}`);
  });
}

module.exports = { createServer, resolveStaticFile };
