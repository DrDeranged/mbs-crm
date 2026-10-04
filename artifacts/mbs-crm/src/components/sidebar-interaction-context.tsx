import { createContext, useCallback, useContext, useEffect, useRef } from "react";

export const SidebarInteractionContext = createContext<{
  setLayerOpen: (owner: symbol, open: boolean) => void;
} | null>(null);

/** A portaled panel still owns its sidebar until it is deliberately dismissed. */
export function useSidebarLayer() {
  const sidebar = useContext(SidebarInteractionContext);
  const owner = useRef(Symbol("sidebar-layer"));
  const setOpen = useCallback((open: boolean) => {
    sidebar?.setLayerOpen(owner.current, open);
  }, [sidebar]);
  useEffect(() => {
    const token = owner.current;
    return () => sidebar?.setLayerOpen(token, false);
  }, [sidebar]);
  return setOpen;
}