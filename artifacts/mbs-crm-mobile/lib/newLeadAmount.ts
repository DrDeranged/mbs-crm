export function parseRequestedAmount(input: string): number | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) {
    throw new Error("Invalid requested amount");
  }
  const amount = Number(value.replace(/,/g, ""));
  if (!Number.isInteger(amount) || amount < 1 || amount > 2147483647) {
    throw new Error("Invalid requested amount");
  }
  return amount;
}