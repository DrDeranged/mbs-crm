export function parseNullableCurrency(value: string | undefined | null): number | null {
  if (!value || value.trim() === "") return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return num;
}