export type NoteMutation = () => Promise<unknown>;

/**
 * A synchronous per-row guard for blur/keyboard event races. React state is
 * intentionally not used here: blur can run before a pending-state render.
 */
export function createNoteSaveController() {
  const inFlight = new Set<number>();

  return {
    isInFlight(rowId: number): boolean {
      return inFlight.has(rowId);
    },

    save(
      rowId: number,
      original: string,
      next: string,
      mutation: NoteMutation,
    ): boolean {
      if (original === next || inFlight.has(rowId)) return false;
      inFlight.add(rowId);
      void mutation().finally(() => inFlight.delete(rowId));
      return true;
    },
  };
}