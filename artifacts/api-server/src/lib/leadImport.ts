export type ParsedLeadImportRow = Record<string, string>;

type ExcelJSModule = typeof import("exceljs") & {
  default?: typeof import("exceljs");
};
type ExcelJSLoader = () => Promise<ExcelJSModule>;

export function parseCsvRows(text: string): ParsedLeadImportRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return [];

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows: ParsedLeadImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const row: ParsedLeadImportRow = {};
    headers.forEach((header, idx) => { row[header] = values[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

export async function parseLeadImportBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string,
  loadExcelJS: ExcelJSLoader = () => import("exceljs"),
): Promise<{ headers: string[]; rows: ParsedLeadImportRow[] }> {
  const isExcel =
    mimetype.includes("spreadsheetml") ||
    mimetype.includes("ms-excel") ||
    originalname.endsWith(".xlsx") ||
    originalname.endsWith(".xls");

  let rawRows: Record<string, unknown>[] = [];

  if (isExcel) {
    const importedExcelJS = await loadExcelJS();
    const ExcelJS = importedExcelJS.default ?? importedExcelJS;
    const workbook = new ExcelJS.Workbook();
    // @ts-expect-error — Node.js Buffer<ArrayBufferLike> vs ExcelJS Buffer type mismatch; runtime-safe
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };

    const excelHeaders: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
      excelHeaders.push(String(cell.value ?? ""));
    });

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj: Record<string, unknown> = {};
      excelHeaders.forEach((header, i) => {
        const cell = row.getCell(i + 1);
        obj[header] = cell.value ?? "";
      });
      rawRows.push(obj);
    });
  } else {
    rawRows = parseCsvRows(buffer.toString("utf-8"));
  }

  if (rawRows.length === 0) return { headers: [], rows: [] };

  const headers = Object.keys(rawRows[0]).map((header) =>
    header.toLowerCase().replace(/\s+/g, "_"),
  );
  const rows: ParsedLeadImportRow[] = rawRows.map((row) => {
    const out: ParsedLeadImportRow = {};
    headers.forEach((header, index) => {
      out[header] = String(Object.values(row)[index] ?? "");
    });
    return out;
  });

  return { headers, rows };
}

const CANONICAL_VERTICAL_ALIASES: Record<string, string> = {
  yellow_iron: "yellow_iron",
  yellowiron: "yellow_iron",
  "yellow iron": "yellow_iron",
  "yellow iron equipment": "yellow_iron",
  trucking: "trucking",
  truck: "trucking",
  trucks: "trucking",
  restaurant: "restaurants",
  restaurants: "restaurants",
  amusement: "amusement",
  "amusement parks": "amusement",
  "amusement park": "amusement",
  general: "general",
};

/**
 * Normalize known vertical labels to the CRM's canonical vertical keys while
 * preserving other user-provided vertical text rather than forcing a taxonomy.
 */
export function normalizeLeadVertical(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, " ").replace(/_/g, " ");
  return CANONICAL_VERTICAL_ALIASES[key] ?? trimmed;
}

export function resolveLeadImportValue(
  row: ParsedLeadImportRow,
  invertedMapping: Record<string, string>,
  ...candidates: string[]
): string {
  for (const candidate of candidates) {
    const mappedColumn = invertedMapping[candidate];
    if (mappedColumn && row[mappedColumn] !== undefined && row[mappedColumn] !== "") {
      return row[mappedColumn];
    }
    if (row[candidate] !== undefined && row[candidate] !== "") return row[candidate];
    const normalized = candidate.toLowerCase().replace(/[\s_]/g, "");
    const key = Object.keys(row).find(
      (column) => column.toLowerCase().replace(/[\s_]/g, "") === normalized,
    );
    if (key && row[key] !== undefined && row[key] !== "") return row[key];
  }
  return "";
}