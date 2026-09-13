/**
 * CSV output helpers shared by streaming exports.
 *
 * Every field is quoted, which handles commas, quotes, and CR/LF uniformly.
 * Prefixing values that could be interpreted as spreadsheet formulas keeps a
 * downloaded CSV from becoming an executable spreadsheet payload.
 */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safeText = /^[\u0000-\u0020]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export interface CsvWritable {
  write(chunk: string): boolean;
  once(event: "drain", listener: () => void): unknown;
}

export async function writeCsvRow(res: CsvWritable, row: unknown[]): Promise<void> {
  if (res.write(`${row.map(csvCell).join(",")}\r\n`)) return;
  await new Promise<void>((resolve) => res.once("drain", resolve));
}