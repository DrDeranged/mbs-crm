import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { computePageSize } from "@/lib/leadsPageSizing";

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Desktop-only: sizes the Leads root to the shell's scroll viewport and derives the
 * page size from the measured table region. Region height is flex-derived, so the
 * page size cannot feed back into it (no oscillation).
 */
export function useLeadsFit(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [rootHeight, setRootHeight] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<number | null>(null);
  const rowHeight = useRef(60);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const parent = scrollParent(root);
    if (root && parent) {
      const cs = getComputedStyle(parent);
      const h = parent.clientHeight - parseFloat(cs.paddingTop || "0") - parseFloat(cs.paddingBottom || "0");
      if (h > 0) setRootHeight((cur) => (cur === h ? cur : h));
    }
    const region = regionRef.current;
    if (region && region.clientHeight > 0) {
      // Keep the largest measured row across pages, so content/font changes
      // cannot make pagination oscillate between short and tall records.
      const rows = region.querySelectorAll<HTMLElement>("[data-leads-row]");
      for (const row of rows) rowHeight.current = Math.max(rowHeight.current, row.getBoundingClientRect().height);
      const headerHeight = region.querySelector("thead")?.getBoundingClientRect().height ?? 40;
      const next = computePageSize(region.clientHeight, rowHeight.current, headerHeight);
      setPageSize((cur) => (cur === next ? cur : next));
    }
  }, []);

  useLayoutEffect(() => {
    if (!enabled) { setRootHeight(null); setPageSize(null); return; }
    measure();
    const ro = new ResizeObserver(measure);
    const parent = scrollParent(rootRef.current);
    if (parent) ro.observe(parent);
    if (rootRef.current) ro.observe(rootRef.current);
    if (regionRef.current) ro.observe(regionRef.current);
    let frame = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    if (regionRef.current) mo.observe(regionRef.current, { childList: true, characterData: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [enabled, measure, rootHeight === null]);

  return { rootRef, regionRef, rootHeight, pageSize };
}
