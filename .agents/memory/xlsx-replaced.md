---
name: xlsx replaced with exceljs
description: xlsx removed due to 4 unfixable HIGH vulns; exceljs is the replacement — requires async API usage.
---

# xlsx → exceljs replacement

**Rule:** Do not re-add `xlsx` to any package. Use `exceljs` for all Excel/spreadsheet parsing and generation.

**Why:** xlsx has 4 HIGH severity vulnerabilities (prototype pollution + ReDoS) with no patched version available in npm. `pnpm audit` confirmed the only remediation was full removal.

**How to apply:**
- Parsing: `const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);` — the load call is promise-based, always `await` it.
- Row access: `wb.worksheets[0]`, then `worksheet.getRow(n).values` (1-indexed, index 0 is empty).
- Callers of any parse function must be `async` and `await` the result.
- See `artifacts/api-server/src/routes/import.ts` for the reference implementation.
