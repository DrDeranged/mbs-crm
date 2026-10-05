export const LEADS_DESKTOP_MIN_WIDTH = 1024;
export const LEADS_ROW_HEIGHT = 60;
export const LEADS_HEAD_HEIGHT = 40;
export const LEADS_MIN_PAGE_SIZE = 1;
export const LEADS_MAX_PAGE_SIZE = 100;
export const LEADS_MOBILE_PAGE_SIZE = 20;

/** Rows that fit in a table region of the given height (header and border included in the region). */
export function computePageSize(
  regionHeight: number,
  rowHeight = LEADS_ROW_HEIGHT,
  headHeight = LEADS_HEAD_HEIGHT,
): number {
  if (!Number.isFinite(regionHeight) || regionHeight <= 0) return LEADS_MIN_PAGE_SIZE;
  const rows = Math.floor((regionHeight - headHeight - 2) / rowHeight);
  return Math.min(LEADS_MAX_PAGE_SIZE, Math.max(LEADS_MIN_PAGE_SIZE, rows));
}

/** Page that keeps the first visible record on screen after the page size changes. */
export function remapPage(page: number, oldLimit: number, newLimit: number): number {
  if (oldLimit <= 0 || newLimit <= 0) return 1;
  const firstIndex = (Math.max(1, page) - 1) * oldLimit;
  return Math.floor(firstIndex / newLimit) + 1;
}

/** Clamp a page into the valid range for the current result set. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(totalPages) || totalPages < 1) return 1;
  return Math.min(Math.max(1, page), totalPages);
}

export function pageRange(page: number, limit: number, total: number): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const start = (page - 1) * limit + 1;
  return { start: Math.min(start, total), end: Math.min(page * limit, total) };
}
