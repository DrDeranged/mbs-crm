export type ListData<T> = {
  items: T[];
  malformed: boolean;
};

export function listData<T>(value: unknown): ListData<T> {
  if (value === undefined) return { items: [], malformed: false };
  return Array.isArray(value)
    ? { items: value as T[], malformed: false }
    : { items: [], malformed: true };
}

export function listPayload<T>(value: unknown, envelopeKeys: string[] = []): ListData<T> {
  if (Array.isArray(value)) return { items: value as T[], malformed: false };
  if (value !== null && typeof value === "object") {
    for (const key of envelopeKeys) {
      const candidate = (value as Record<string, unknown>)[key];
      if (Array.isArray(candidate)) return { items: candidate as T[], malformed: false };
    }
  }
  return { items: [], malformed: true };
}