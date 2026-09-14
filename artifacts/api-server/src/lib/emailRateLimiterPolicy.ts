export function canReserveEmailRateSlot(activeReservations: number, limit: number): boolean {
  const cap = Math.max(1, Math.min(1000, Math.floor(limit)));
  return activeReservations < cap;
}