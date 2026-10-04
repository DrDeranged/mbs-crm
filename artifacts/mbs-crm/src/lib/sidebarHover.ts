export const SIDEBAR_OPEN_DELAY = 120;
export const SIDEBAR_CLOSE_DELAY = 200;

type Scheduler = (callback: () => void, delay: number) => () => void;
const schedule: Scheduler = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
};

/** One cancellable intent: repeated enter/focus events must not restart it. */
export function createSidebarHoverController(
  change: (open: boolean) => void,
  canApply: (open: boolean) => boolean,
  later: Scheduler = schedule,
) {
  let current = false;
  let pending: { open: boolean; cancel: () => void } | null = null;
  const cancel = () => {
    pending?.cancel();
    pending = null;
  };
  const setOpen = (open: boolean) => {
    cancel();
    current = open;
    change(open);
  };
  return {
    cancel,
    setOpen,
    request(open: boolean) {
      if (pending?.open === open) return;
      cancel();
      if (current === open || !canApply(open)) return;
      const intent = { open, cancel: () => {} };
      pending = intent;
      intent.cancel = later(() => {
        if (pending !== intent) return;
        pending = null;
        if (!canApply(open)) return;
        current = open;
        change(open);
      }, open ? SIDEBAR_OPEN_DELAY : SIDEBAR_CLOSE_DELAY);
    },
  };
}