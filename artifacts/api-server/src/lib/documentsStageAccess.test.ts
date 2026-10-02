import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

const actor = {
  id: 7,
  clerkId: "rep-7",
  name: "Rep Seven",
  title: null,
  email: "rep7@example.com",
  slug: "rep-seven",
  role: "rep" as const,
  isActive: true,
  mobileNumber: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function requestUpload(
  lead: { id: number; assignedRepId: number; leadSource: string; status: string },
) {
  const { createDocumentsRouter } = await import("../routes/documents");
  const storedFiles: string[] = [];
  const docRows: any[] = [];
  const database = {
    query: {
      leadsTable: {
        async findFirst() {
          return lead;
        },
      },
    },
    async transaction(callback: (tx: any) => Promise<unknown>) {
      return callback({
        insert() {
          return {
            values(values: Record<string, unknown>) {
              return {
                async returning() {
                  const doc = {
                    id: docRows.length + 1,
                    ...values,
                    createdAt: new Date("2026-01-02T00:00:00.000Z"),
                  };
                  docRows.push(doc);
                  return [doc];
                },
              };
            },
          };
        },
      });
    },
  };
  const app = express();
  app.use("/api", createDocumentsRouter({
    database: database as any,
    authenticate: async () => actor as any,
    activityLogger: async () => undefined,
    saveUploadedFile: async (key) => {
      storedFiles.push(key);
    },
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const form = new FormData();
    form.set("category", "other");
    form.set("file", new Blob(["controlled test content"], { type: "text/plain" }), "proof.txt");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/leads/${lead.id}/documents`, {
      method: "POST",
      body: form,
    });
    return {
      response,
      payload: await response.json() as Record<string, unknown>,
      storedFiles,
      docRows,
    };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

for (const status of ["funded", "declined"]) {
  test(`authorized ${status} lead can upload a document through the real API route`, async () => {
    const result = await requestUpload({
      id: status === "funded" ? 701 : 702,
      assignedRepId: actor.id,
      leadSource: "manual",
      status,
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.payload.leadId, status === "funded" ? 701 : 702);
    assert.equal(result.payload.category, "other");
    assert.equal(result.storedFiles.length, 1);
    assert.equal(result.docRows.length, 1);
  });
}

test("deal visibility does not authorize upload to a linked lead owned by another rep", async () => {
  const result = await requestUpload({
    id: 703,
    assignedRepId: actor.id + 1,
    leadSource: "manual",
    status: "funded",
  });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.storedFiles, []);
  assert.deepEqual(result.docRows, []);
});