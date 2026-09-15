import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import express from "express";
import { documentsTable } from "@workspace/db";
import { createDocumentsRouter } from "../routes/documents";
import {
  DOCUMENT_CATEGORIES,
  getLegacyDocumentCategory,
  inferDocumentCategoryFromFilename,
} from "./documentsCategory";

test("legacy document category helper mirrors migration 019 key backfill", () => {
  assert.equal(
    getLegacyDocumentCategory("leads/42/documents/bankstatement-2025-01.pdf"),
    "bank_statement",
  );
  assert.equal(
    getLegacyDocumentCategory("leads/42/documents/signed-application-1700000000.html"),
    "signed_application",
  );
  assert.equal(getLegacyDocumentCategory("leads/42/documents/statement.pdf"), "other");
  assert.equal(getLegacyDocumentCategory("leads/42/documents/signed-application-1.pdf"), "other");
  assert.equal(inferDocumentCategoryFromFilename("January Bank Statement.pdf"), "bank_statement");
  assert.equal(inferDocumentCategoryFromFilename("equipment quote.pdf"), "other");

  const migration = readFileSync(
    new URL("../../../../lib/db/migrations/019_document_categories.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /WHEN "file_key" ~ '\/documents\/bankstatement-' THEN 'bank_statement'/);
  assert.match(
    migration,
    /WHEN "file_key" ~ '\/documents\/signed-application-\[\^\/\]\*\[\.\]html\$' THEN 'signed_application'/,
  );
  for (const category of DOCUMENT_CATEGORIES) {
    assert.match(migration, new RegExp(`'${category}'`));
  }
  assert.match(migration, /DEFAULT 'other'/);
});

function makeDocumentCategoryDatabase(assignedRepId: number) {
  const document = {
    id: 17,
    leadId: 42,
    userId: 7,
    filename: "january.pdf",
    fileKey: "leads/42/documents/1700000000.pdf",
    fileType: "application/pdf",
    fileSize: 100,
    category: "other",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  let updateCalls = 0;
  const database = {
    query: {
      documentsTable: { findFirst: async () => document },
      leadsTable: { findFirst: async () => ({ id: 42, assignedRepId }) },
    },
    update(table: unknown) {
      assert.equal(table, documentsTable);
      return {
        set(values: { category: string }) {
          return {
            where() {
              return {
                returning: async () => {
                  updateCalls += 1;
                  return [{ ...document, category: values.category }];
                },
              };
            },
          };
        },
      };
    },
    get updateCalls() {
      return updateCalls;
    },
  };
  return database;
}

async function patchCategory(router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return await fetch(`http://127.0.0.1:${address.port}/documents/17`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "bank_statement" }),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("a rep cannot update a document category for another rep's lead", async () => {
  const database = makeDocumentCategoryDatabase(8);
  const response = await patchCategory(createDocumentsRouter({
    database: database as any,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    activityLogger: async () => {},
  }) as express.Router);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
  assert.equal(database.updateCalls, 0);
});

test("a rep can update a document category for their assigned lead", async () => {
  const database = makeDocumentCategoryDatabase(7);
  const response = await patchCategory(createDocumentsRouter({
    database: database as any,
    authenticate: async () => ({ id: 7, role: "rep" } as any),
    activityLogger: async () => {},
  }) as express.Router);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { category: string }).category, "bank_statement");
  assert.equal(database.updateCalls, 1);
});