import { useCallback, useEffect, useState } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

export function sidebarPinKey(userId: string) {
  return `mbs-desktop-sidebar-pinned:${userId}`;
}

export function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery(DESKTOP_QUERY);

function isEditingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  return Boolean(el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], .ProseMirror, [role='textbox'], [role='combobox']"));
}

/** Pin state per Clerk user; unpinned by default. Ctrl/Cmd+B toggles on desktop outside text entry. */
export function useDesktopSidebarPin(userId: string | null | undefined, desktop: boolean) {
  const [state, setState] = useState<{ key: string | null; pinned: boolean }>({ key: null, pinned: false });
  const key = userId ? sidebarPinKey(userId) : null;

  useEffect(() => {
    if (!key) { setState({ key: null, pinned: false }); return; }
    let pinned = false;
    try { pinned = window.localStorage.getItem(key) === "true"; } catch { /* storage unavailable */ }
    setState({ key, pinned });
  }, [key]);

  const pinned = state.key === key && key !== null && state.pinned;

  const setPinned = useCallback((next: boolean | ((p: boolean) => boolean)) => {
    setState((cur) => {
      if (!key || cur.key !== key) return cur;
      const value = typeof next === "function" ? next(cur.pinned) : next;
      try { window.localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ }
      return { key, pinned: value };
    });
  }, [key]);

  useEffect(() => {
    if (!desktop) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
      if (isEditingTarget(event.target) || isEditingTarget(document.activeElement)) return;
      // A popup can temporarily lose focus when its read buttons become disabled.
      // Keep the pin shortcut from removing its trigger during that interval.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return;
      event.preventDefault();
      setPinned((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, setPinned]);

  return { pinned, setPinned };
}
