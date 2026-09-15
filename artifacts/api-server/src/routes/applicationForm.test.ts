import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import express from "express";
import { createApplicationFormRouter } from "./applicationForm";
import { createPublicApplicationFormRouter } from "./repPublic";

const user = (id: number, role: string) => ({
  id,
  role,
  name: "Nate Ford",
  title: "CHIEF EXECUTIVE OFFICER",
  email: "nate@my-business-solutions.com",
  mobileNumber: "602.245.5425",
  slug: "nate",
  isActive: true,
}) as any;

async function requestWithRouter(router: any, path: string, redirect: RequestInit["redirect"] = "follow"): Promise<Response> {
  const app = express();
  app.use(router);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    return await fetch(`http://127.0.0.1:${address.port}${path}`, { redirect });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function authenticatedRouter(actor: any) {
  return createApplicationFormRouter({
    authenticate: async (_req, _res) => actor,
    database: {
      query: {
        usersTable: {
          findFirst: async () => user(7, "rep"),
        },
      },
    } as any,
    renderPdf: async () => Buffer.from("%PDF-test"),
  });
}

test("application form route enforces authentication and role scope", async () => {
  const unauthenticated = createApplicationFormRouter({
    authenticate: async (_req, res) => {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    },
  });
  assert.equal((await requestWithRouter(unauthenticated, "/users/7/application-form.pdf")).status, 401);
  assert.equal((await requestWithRouter(authenticatedRouter(user(8, "rep")), "/users/7/application-form.pdf")).status, 403);
  assert.equal((await requestWithRouter(authenticatedRouter(user(8, "manager")), "/users/7/application-form.pdf")).status, 403);
  const own = await requestWithRouter(authenticatedRouter(user(7, "rep")), "/users/7/application-form.pdf");
  assert.equal(own.status, 200);
  assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await requestWithRouter(authenticatedRouter(user(8, "admin")), "/users/7/application-form.pdf")).status, 200);
});

test("public application form returns PDF and retired slugs redirect canonically", async () => {
  const pdfRouter = createPublicApplicationFormRouter({
    resolve: async () => ({ user: user(7, "rep"), replacementSlug: null }),
    renderPdf: async () => Buffer.from("%PDF-public"),
  });
  const response = await requestWithRouter(pdfRouter, "/public/reps/nate/application-form.pdf");
  assert.equal(response.status, 200);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  const retiredRouter = createPublicApplicationFormRouter({
    resolve: async () => ({ user: user(7, "rep"), replacementSlug: "nate" }),
    renderPdf: async () => Buffer.from("%PDF-public"),
  });
  const retired = await requestWithRouter(retiredRouter, "/public/reps/old-nate/application-form.pdf", "manual");
  assert.equal(retired.status, 301);
  assert.match(retired.headers.get("location") ?? "", /\/public\/reps\/nate\/application-form\.pdf$/);
});