import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestListener,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createRuntimeProxy } from "./runtimeProxy";

type CapturedResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function proxyServer(
  t: TestContext,
  upstreamHandler: RequestListener,
): Promise<number> {
  const upstream = createServer(upstreamHandler);
  const upstreamPort = await listen(upstream);
  const proxy = createServer(createRuntimeProxy(upstreamPort));
  const proxyPort = await listen(proxy);
  t.after(async () => {
    await close(proxy);
    await close(upstream);
  });
  return proxyPort;
}

function requestBuffer(
  port: number,
  options: {
    method?: string;
    path?: string;
    headers?: Record<string, string | number>;
  } = {},
  body = Buffer.alloc(0),
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      method: options.method ?? "GET",
      path: options.path ?? "/",
      headers: options.headers,
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("proxy forwards signed raw bytes and preserves host and one-hop forwarding headers", async (t) => {
  const received: Array<{
    headers: IncomingHttpHeaders;
    body: Buffer;
  }> = [];
  let resolveReceivedRequest!: () => void;
  const receivedRequest = new Promise<void>((resolve) => {
    resolveReceivedRequest = resolve;
  });
  const upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(204);
      res.end();
      resolveReceivedRequest();
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createServer(createRuntimeProxy(upstreamPort));
  const proxyPort = await listen(proxy);
  t.after(async () => {
    await close(proxy);
    await close(upstream);
  });

  const body = Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x00, 0xff, 0x7d]);
  const response = await requestBuffer(proxyPort, {
    method: "POST",
    path: "/api/provider/hook?key=a%2Fb",
    headers: {
      host: "crm.example.test",
      "content-type": "application/octet-stream",
      "content-length": body.length,
      "x-twilio-signature": "signed-payload-value",
      "x-forwarded-for": "198.51.100.42, 10.0.0.12",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "crm.example.test",
    },
  }, body);
  assert.equal(response.statusCode, 204);
  await receivedRequest;
  assert.equal(received.length, 1);
  assert.deepEqual(received[0]?.body, body);
  assert.equal(received[0]?.headers["x-twilio-signature"], "signed-payload-value");
  assert.equal(received[0]?.headers.host, "crm.example.test");
  assert.equal(received[0]?.headers["x-forwarded-host"], "crm.example.test");
  assert.equal(received[0]?.headers["x-forwarded-proto"], "https");
  assert.equal(received[0]?.headers["x-forwarded-for"], "198.51.100.42, 10.0.0.12");
});

test("proxy streams headers and response chunks before the upstream finishes", { timeout: 3_000 }, async (t) => {
  let releaseSecondChunk!: () => void;
  const secondChunkGate = new Promise<void>((resolve) => {
    releaseSecondChunk = resolve;
  });
  const port = await proxyServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    res.write("first");
    void secondChunkGate.then(() => res.end("second"));
  });
  t.after(() => releaseSecondChunk());

  const clientRequest = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/health/stream",
    agent: false,
  });
  const responsePromise = new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    clientRequest.once("response", resolve);
    clientRequest.once("error", reject);
  });
  clientRequest.end();
  const response = await responsePromise;
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "text/event-stream");

  const chunks: Buffer[] = [];
  let resolveFirstChunk!: () => void;
  let resolveResponseEnd!: () => void;
  const firstChunk = new Promise<void>((resolve) => { resolveFirstChunk = resolve; });
  const responseEnd = new Promise<void>((resolve) => { resolveResponseEnd = resolve; });
  response.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.from(chunk));
    resolveFirstChunk();
  });
  response.on("end", resolveResponseEnd);
  response.on("error", (error) => {
    clientRequest.destroy(error);
  });

  await firstChunk;
  assert.equal(Buffer.concat(chunks).toString(), "first");
  releaseSecondChunk();
  await responseEnd;
  assert.equal(Buffer.concat(chunks).toString(), "firstsecond");
});

test("proxy returns an explicit 503 when the private runtime connection fails", async (t) => {
  const unavailable = createServer();
  const unavailablePort = await listen(unavailable);
  await close(unavailable);

  const proxy = createServer(createRuntimeProxy(unavailablePort));
  const port = await listen(proxy);
  t.after(() => close(proxy));

  const response = await requestBuffer(port, { path: "/api/leads" });
  assert.equal(response.statusCode, 503);
  assert.equal(response.headers["retry-after"], "5");
  assert.deepEqual(JSON.parse(response.body.toString()), {
    error: "API runtime unavailable",
  });
});

test("proxy forwards the socket address as a single fallback hop when X-Forwarded-For is absent", async (t) => {
  let forwardedFor: string | string[] | undefined;
  const port = await proxyServer(t, (req, res) => {
    forwardedFor = req.headers["x-forwarded-for"];
    res.writeHead(204);
    res.end();
  });

  const response = await requestBuffer(port);
  assert.equal(response.statusCode, 204);
  assert.equal(forwardedFor, "127.0.0.1");
});

test("proxy aborts the public response if an upstream stream fails after headers", { timeout: 3_000 }, async (t) => {
  const port = await proxyServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    res.write("partial");
    setImmediate(() => res.destroy());
  });

  const clientRequest = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/health/stream",
    agent: false,
  });
  const aborted = new Promise<void>((resolve, reject) => {
    clientRequest.once("response", (response) => {
      response.once("aborted", resolve);
      response.once("end", () => reject(new Error("failed upstream response must not end cleanly")));
      response.once("error", () => resolve());
    });
    clientRequest.once("error", reject);
  });
  clientRequest.end();
  await aborted;
});

test("aborting the public response closes the corresponding upstream response", { timeout: 3_000 }, async (t) => {
  let upstreamResponseClosed!: () => void;
  const upstreamClosed = new Promise<void>((resolve) => {
    upstreamResponseClosed = resolve;
  });
  const port = await proxyServer(t, (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    res.write("ready");
    res.once("close", upstreamResponseClosed);
  });

  const clientRequest = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/health/stream",
    agent: false,
  });
  clientRequest.on("error", () => undefined);
  clientRequest.once("response", (response) => {
    response.once("data", () => clientRequest.destroy());
  });
  clientRequest.end();
  await upstreamClosed;
});

test("aborting an incoming upload cancels the forwarded upstream request", { timeout: 3_000 }, async (t) => {
  let upstreamRequestAborted!: () => void;
  let resolveUpstreamRequestStarted!: () => void;
  const upstreamAborted = new Promise<void>((resolve) => {
    upstreamRequestAborted = resolve;
  });
  const upstreamRequestStarted = new Promise<void>((resolve) => {
    resolveUpstreamRequestStarted = resolve;
  });
  const port = await proxyServer(t, (req) => {
    req.once("data", resolveUpstreamRequestStarted);
    req.once("aborted", upstreamRequestAborted);
  });

  const clientRequest = httpRequest({
    hostname: "127.0.0.1",
    port,
    method: "POST",
    path: "/api/leads/import",
    headers: { "content-length": 1_000_000 },
    agent: false,
  });
  clientRequest.on("error", () => undefined);
  clientRequest.write(Buffer.alloc(1_024, 65));
  await upstreamRequestStarted;
  clientRequest.destroy();
  await upstreamAborted;
});