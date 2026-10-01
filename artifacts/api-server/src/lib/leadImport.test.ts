import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLeadVertical,
  parseCsvRows,
  parseLeadImportBuffer,
  resolveLeadImportValue,
} from "./leadImport";

test("CSV lead import parser keeps vertical column values", () => {
  const [row] = parseCsvRows("First Name,Vertical,Email\nAda,Trucking,ada@example.com");
  assert.deepEqual(row, {
    "First Name": "Ada",
    Vertical: "Trucking",
    Email: "ada@example.com",
  });
});

test("CSV buffer parsing does not load the optional ExcelJS parser", async () => {
  let excelLoads = 0;
  const parsed = await parseLeadImportBuffer(
    Buffer.from("First Name,Email\nAda,ada@example.com"),
    "text/csv",
    "leads.csv",
    async () => {
      excelLoads++;
      throw new Error("ExcelJS should not be loaded for CSV input");
    },
  );

  assert.equal(excelLoads, 0);
  assert.deepEqual(parsed, {
    headers: ["first_name", "email"],
    rows: [{ first_name: "Ada", email: "ada@example.com" }],
  });
});

test("Excel buffer parsing lazily loads ExcelJS and preserves normalized rows", async () => {
  const importedExcelJS = await import("exceljs") as typeof import("exceljs") & {
    default: typeof import("exceljs");
  };
  const workbook = new importedExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet("Leads");
  sheet.addRow(["First Name", "Email"]);
  sheet.addRow(["Ada", "ada@example.com"]);
  const bytes = await workbook.xlsx.writeBuffer();
  let excelLoads = 0;

  const parsed = await parseLeadImportBuffer(
    Buffer.from(bytes),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "leads.xlsx",
    async () => {
      excelLoads++;
      return importedExcelJS;
    },
  );

  assert.equal(excelLoads, 1);
  assert.deepEqual(parsed, {
    headers: ["first_name", "email"],
    rows: [{ first_name: "Ada", email: "ada@example.com" }],
  });
});

test("lead import resolves an explicitly mapped vertical source column", () => {
  const row = { business_type: "Yellow Iron" };
  const value = resolveLeadImportValue(row, { vertical: "business_type" }, "vertical");
  assert.equal(normalizeLeadVertical(value), "yellow_iron");
});

test("known verticals normalize to canonical values and unknown values remain intact", () => {
  assert.equal(normalizeLeadVertical("Trucking"), "trucking");
  assert.equal(normalizeLeadVertical("Restaurants"), "restaurants");
  assert.equal(normalizeLeadVertical("amusement park"), "amusement");
  assert.equal(normalizeLeadVertical("General"), "general");
  assert.equal(normalizeLeadVertical("Specialty manufacturing"), "Specialty manufacturing");
  assert.equal(normalizeLeadVertical("  "), null);
});