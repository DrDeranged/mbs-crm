import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Bell, UserPlus, MessageSquare, ArrowRightCircle, FileText, CreditCard, Phone, Clock, CheckCheck } from "lucide-react";
import { useGetUnreadNotificationCount, useListNotifications, useMarkAllNotificationsRead, useMarkNotificationRead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TYPE_ICON: Record<string, React.ElementType> = {
  lead_assigned: UserPlus,
  sms_received: MessageSquare,
  status_changed: ArrowRightCircle,
  application_received: FileText,
  credit_pulled: CreditCard,
  call_received: Phone,
  task_due: Clock,
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: countData, refetch: refetchCount } = useGetUnreadNotificationCount();
  const { data: listData, refetch: refetchList } = useListNotifications({ page: 1, limit: 20 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = countData?.count ?? 0;
  const notifications = listData?.data ?? [];

  // Poll every 30 seconds
  useEffect(() => {
    const id = setInterval(() => {
      refetchCount();
      if (open) refetchList();
    }, 30_000);
    return () => clearInterval(id);
  }, [open, refetchCount, refetchList]);

  // Fetch list when opening
  useEffect(() => {
    if (open) refetchList();
  }, [open, refetchList]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClickNotification = async (n: { id: number; isRead: boolean; leadId?: number | null }) => {
    if (!n.isRead) {
      await markRead.mutateAsync({ id: n.id });
      refetchCount();
      refetchList();
    }
    if (n.leadId) {
      navigate(`/leads/${n.leadId}`);
    }
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    await markAllRead.mutateAsync();
    refetchCount();
    refetchList();
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative text-sidebar-foreground/60 hover:bg-accent hover:text-accent-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto max-h-[400px]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Bell size={28} className="opacity-30" />
                <span className="text-sm">No notifications yet</span>
              </div>
            ) : (
              notifications.map((n: any) => {
                const Icon = TYPE_ICON[n.type as string] ?? Bell;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClickNotification(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 border-b border-border/50 last:border-0",
                      !n.isRead && "bg-primary/5",
                    )}
                  >
                    <div className={cn("mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full", !n.isRead ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                      <Icon size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-1">
                        <p className={cn("text-xs leading-snug truncate", !n.isRead ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                          {n.title}
                        </p>
                        {!n.isRead && <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-primary mt-1" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
