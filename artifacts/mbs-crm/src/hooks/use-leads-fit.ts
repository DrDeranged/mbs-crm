import { useCallback, useLayoutEffect, useRef, useState } from "react";

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
 * Desktop-only: fit the fixed toolbar and scrollable records region to the shell.
 * Record fetching is independent of viewport height.
 */
export function useLeadsFit(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [rootHeight, setRootHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const parent = scrollParent(root);
    if (root && parent) {
      const cs = getComputedStyle(parent);
      const h = parent.clientHeight - parseFloat(cs.paddingTop || "0") - parseFloat(cs.paddingBottom || "0");
      if (h > 0) setRootHeight((cur) => (cur === h ? cur : h));
    }
  }, []);

  useLayoutEffect(() => {
    if (!enabled) { setRootHeight(null); return; }
    measure();
    const ro = new ResizeObserver(measure);
    const parent = scrollParent(rootRef.current);
    if (parent) ro.observe(parent);
    if (rootRef.current) ro.observe(rootRef.current);
    if (regionRef.current) ro.observe(regionRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [enabled, measure, rootHeight === null]);

  return { rootRef, regionRef, rootHeight };
}
