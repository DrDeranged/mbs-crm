import { useEffect, useState } from "react";
import { FileUp, Pencil, Phone, MessageSquare, Mail, StickyNote, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobileWeb } from "@/hooks/use-mobile";
import { MOBILE_ACTION_MIN_WIDTH, RECORD_ACTION_MIN_TOUCH_HEIGHT, type RecordAction } from "@/lib/recordActions";

export type { RecordAction } from "@/lib/recordActions";

export interface RecordActionItem {
  action: RecordAction;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

const ACTIONS: Array<{ action: RecordAction; label: string; Icon: typeof FileUp }> = [
  { action: "upload", label: "Upload", Icon: FileUp },
  { action: "edit", label: "Edit", Icon: Pencil },
  { action: "call", label: "Call", Icon: Phone },
  { action: "text", label: "Text", Icon: MessageSquare },
  { action: "email", label: "Email", Icon: Mail },
  { action: "note", label: "Note", Icon: StickyNote },
  { action: "task", label: "Task", Icon: ListTodo },
];

function useKeyboardClearance() {
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return keyboardInset;
}

export function RecordActionBar({ items, className }: { items: RecordActionItem[]; className?: string }) {
  const mobile = useIsMobileWeb();
  const keyboardInset = useKeyboardClearance();
  const itemByAction = new Map(items.map((item) => [item.action, item]));
  const renderActions = (mobile: boolean) => ACTIONS.map(({ action, label, Icon }) => {
    const item = itemByAction.get(action);
    if (!item) return null;
    const title = item.disabled ? item.disabledReason || `${label} unavailable` : label;
    return (
      <button
        key={action}
        type="button"
        disabled={item.disabled}
        title={title}
        aria-label={item.disabled ? `${label}: ${title}` : label}
        onClick={item.onClick}
        style={{ minHeight: RECORD_ACTION_MIN_TOUCH_HEIGHT, ...(mobile ? { minWidth: MOBILE_ACTION_MIN_WIDTH } : {}) }}
        className={cn(
          "inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border border-border bg-card px-2 text-sm font-medium text-foreground transition-colors hover:bg-info-bg hover:text-info disabled:cursor-not-allowed disabled:opacity-50",
          mobile && "h-12 min-w-12 flex-col gap-0 px-0 text-[10px] leading-tight"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", mobile && "h-4 w-4")} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  });

  return (
    <>
      <nav aria-label="Record actions" className={cn("sticky top-0 z-[var(--z-header)] border-b bg-card px-4 py-2 backdrop-blur", mobile ? "hidden" : "block", className)}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">{renderActions(false)}</div>
      </nav>
      <nav
        aria-label="Record actions"
        className={cn("fixed inset-x-0 z-[var(--z-header)] overflow-x-auto border-t border-border bg-card px-2 pt-2 backdrop-blur", mobile ? "block" : "hidden")}
        style={{
          bottom: `calc(env(safe-area-inset-bottom) + ${keyboardInset}px)`,
          paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
        }}
      >
        <div className="flex min-w-max gap-1">{renderActions(true)}</div>
      </nav>
    </>
  );
}