export type BuilderSection = "cover" | "application" | "invoice_quote" | "bank_statement" | "drivers_license" | "tax_return" | "other";
export type BuilderConfig = {
  sections: BuilderSection[];
  documentIds: number[];
  options: { includeCoverPage: boolean; includeFooter: boolean };
};

const allSections: BuilderSection[] = ["cover", "application", "invoice_quote", "bank_statement", "drivers_license", "tax_return", "other"];

export function defaultBuilderConfig(documents: Array<{ id: number }>): BuilderConfig {
  return { sections: allSections, documentIds: documents.map((document) => document.id), options: { includeCoverPage: true, includeFooter: true } };
}

/** Do not initialize until both independent requests have settled. */
export function initializeBuilderConfig(
  documents: Array<{ id: number }> | undefined,
  savedConfig: { packageConfig?: (Omit<Partial<BuilderConfig>, "options"> & { options?: Partial<BuilderConfig["options"]> }) | null } | undefined,
  documentsPending: boolean,
  configPending: boolean,
): BuilderConfig | null {
  if (documentsPending || configPending || documents === undefined || savedConfig === undefined) return null;
  const fallback = defaultBuilderConfig(documents);
  const saved = savedConfig.packageConfig;
  if (!saved) return fallback;
  const existing = new Set(documents.map((document) => document.id));
  return {
    ...fallback,
    ...saved,
    documentIds: (saved.documentIds ?? fallback.documentIds).filter((id) => existing.has(id)),
    options: { ...fallback.options, ...saved.options },
  };
}

export function appendUploadedDocument(config: BuilderConfig, documentId: number): BuilderConfig {
  return config.documentIds.includes(documentId) ? config : { ...config, documentIds: [...config.documentIds, documentId] };
}