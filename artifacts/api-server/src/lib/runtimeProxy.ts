import { request, type RequestListener } from "node:http";

/** A raw, streaming hop to the private runtime. Never parse signed payloads. */
export function createRuntimeProxy(port: number): RequestListener {
  return (req, res) => {
    const upstream = request({
      hostname: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        // Preserve the existing one-hop trust-proxy semantics. If the public
        // proxy supplied forwarding headers, carry them unchanged.
        "x-forwarded-for": req.headers["x-forwarded-for"] ?? req.socket.remoteAddress,
        "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? "http",
      },
    }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      res.flushHeaders();
      response.pipe(res);
      response.on("error", () => res.destroy());
    });
    upstream.on("error", () => {
      if (res.headersSent) {
        res.destroy();
      } else {
        res.writeHead(503, { "content-type": "application/json", "retry-after": "5" });
        res.end(JSON.stringify({ error: "API runtime unavailable" }));
      }
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  };
}