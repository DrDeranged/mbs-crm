export const DOCUMENT_CATEGORIES = [
  "bank_statement",
  "invoice_quote",
  "drivers_license",
  "tax_return",
  "signed_application",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

const legacyBankStatementKey = /\/documents\/bankstatement-/;
const legacySignedApplicationKey = /\/documents\/signed-application-[^/]*\.html$/;

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

export function inferDocumentCategoryFromFilename(filename: string): DocumentCategory {
  return /bank|statement/i.test(filename) ? "bank_statement" : "other";
}

/**
 * Mirrors migration 019 for unit tests and any future import tooling. The
 * migration intentionally classifies from the storage key, not display names.
 */
export function getLegacyDocumentCategory(fileKey: string): DocumentCategory {
  if (legacyBankStatementKey.test(fileKey)) return "bank_statement";
  if (legacySignedApplicationKey.test(fileKey)) return "signed_application";
  return "other";
}