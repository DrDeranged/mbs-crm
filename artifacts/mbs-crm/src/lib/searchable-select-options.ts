export type SearchableOption = {
  value: string;
  label: string;
  detail?: string;
  keywords?: string | string[];
  disabled?: boolean;
};

export function filterSearchableOptions(options: SearchableOption[], query: string): SearchableOption[] {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return options;
  return options.filter(({ label, keywords }) =>
    `${label} ${typeof keywords === "string" ? keywords : (keywords ?? []).join(" ")}`
      .toLocaleLowerCase().includes(search));
}