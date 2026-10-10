/** Space below the page's actual top, bounded by its scroll container. */
export function leadsFitHeight(containerBottom: number, pageTop: number, paddingBottom: number): number {
  if (![containerBottom, pageTop, paddingBottom].every(Number.isFinite)) return 0;
  return Math.max(0, Math.floor(containerBottom - pageTop - paddingBottom));
}
