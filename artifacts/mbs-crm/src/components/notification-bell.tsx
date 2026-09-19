import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Bell, UserPlus, MessageSquare, ArrowRightCircle, FileText, CreditCard, Phone, Clock, CheckCheck, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { useGetUnreadNotificationCount, useListNotifications, getListNotificationsQueryKey, useMarkAllNotificationsRead, useMarkNotificationRead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { notificationTarget } from "@/lib/notificationNavigation";

const TYPE_ICON: Record<string, React.ElementType> = {
  lead_assigned: UserPlus,
  sms_received: MessageSquare,
  status_changed: ArrowRightCircle,
  application_received: FileText,
  credit_pulled: CreditCard,
  call_received: Phone,
  task_due: Clock,
  renewal_opportunity: RefreshCw,
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function NotificationBell({ onDark = true }: { onDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [location, navigate] = useLocation();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { data: countData, refetch: refetchCount } = useGetUnreadNotificationCount();
  const { data: listData, isLoading, isError, refetch: refetchList } = useListNotifications({ page: 1, limit: 20 }, { query: { enabled: open, queryKey: getListNotificationsQueryKey({ page: 1, limit: 20 }) } });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = countData?.count ?? 0;
  const notifications = listData?.data ?? [];

  // Poll for counts
  useEffect(() => {
    const id = setInterval(() => {
      refetchCount();
      if (open) refetchList();
    }, 30_000);
    return () => clearInterval(id);
  }, [open, refetchCount, refetchList]);

  // Close on route change and restore focus
  useEffect(() => {
    if (open) {
      setOpen(false);
      // Restore focus to trigger on route change
      setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClickNotification = async (n: { id: number; isRead: boolean; leadId?: number | null }) => {
    if (!n.isRead) {
      try {
        await markRead.mutateAsync({ id: n.id });
        refetchCount();
        refetchList();
      } catch (err) {
        toast({ title: "Failed to mark as read", variant: "destructive" });
      }
    }

    const target = notificationTarget(n.leadId);
    if (target) {
      navigate(target);
    } else {
      toast({ title: "Cannot open record", description: "API Limitation: No lead ID provided for this notification.", variant: "default" });
    }
    setOpen(false);
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead.mutateAsync();
      refetchCount();
      refetchList();
      toast({ title: "All caught up", description: "All notifications marked as read." });
    } catch (err) {
      toast({ title: "Failed to mark all as read", variant: "destructive" });
    }
  };

  const Content = (
    <div className="flex flex-col h-full max-h-[70vh] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
        <span className="text-sm font-semibold">Notifications</span>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markAllRead.isPending}
            className="flex items-center gap-1 text-xs text-white/60 hover:text-white transition-colors disabled:opacity-50"
          >
            <CheckCheck size={13} />
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/55 gap-2">
            <Loader2 size={24} className="animate-spin text-[#17A567]" />
            <span className="text-sm">Loading notifications...</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/55 gap-2">
            <AlertCircle size={28} className="text-red-400" />
            <span className="text-sm">Failed to load notifications</span>
            <Button variant="ghost" size="sm" onClick={() => refetchList()} className="mt-2 text-xs">Retry</Button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/55 gap-2">
            <Bell size={28} className="opacity-30" />
            <span className="text-sm">You're all caught up.</span>
          </div>
        ) : (
          notifications.map((n: any) => {
            const Icon = TYPE_ICON[n.type as string] ?? Bell;
            return (
              <button
                key={n.id}
                onClick={() => handleClickNotification(n)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/8 border-b border-white/8 last:border-0",
                  !n.isRead && "bg-white/6"
                )}
              >
                <div className={cn("mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full", !n.isRead ? "bg-[#17A567]/20 text-[#65D5A2]" : "bg-white/10 text-white/55")}>
                  <Icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <p className={cn("text-xs leading-snug truncate", !n.isRead ? "font-semibold text-white" : "font-medium text-white/80")}>
                      {n.title}
                    </p>
                    {!n.isRead && <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-[#17A567] mt-1" />}
                  </div>
                  <p className="text-xs text-white/60 mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-[10px] text-white/40 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const TriggerButton = (
    <Button
      ref={triggerRef}
      variant="ghost"
      size="icon"
      onClick={() => isMobile && setOpen(true)}
      className={cn(
        "relative",
        onDark
          ? "text-sidebar-foreground/70 hover:bg-white/10 hover:text-white"
          : "text-[#0E2A47] hover:bg-[#17A567]/10 hover:text-[#149258]"
      )}
      aria-label="Notifications"
    >
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#17A567] px-1 text-[10px] font-bold text-white leading-none shadow-[0_0_0_2px_#0E2A47] animate-pulse motion-reduce:animate-none">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {TriggerButton}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" overlayClassName="z-[var(--z-notification-backdrop)]" showClose={false} className="p-0 bg-[#0E2A47]/95 border-t border-white/15 backdrop-blur-xl z-[var(--z-popover)] max-h-[70vh]">
            <SheetHeader className="sr-only">
              <SheetTitle>Notifications</SheetTitle>
            </SheetHeader>
            {Content}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {TriggerButton}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[var(--z-popover)] overflow-hidden rounded-[14px] border border-white/15 bg-[#0E2A47]/95 p-0 shadow-2xl backdrop-blur-xl w-[380px]"
      >
        {Content}
      </PopoverContent>
    </Popover>
  );
}