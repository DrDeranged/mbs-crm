import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import {
  LayoutDashboard, Users, Settings as SettingsIcon, LogOut, Upload, Mail, Zap, Building2, Megaphone,
  ShieldCheck, GitBranch, Activity, Briefcase, ClipboardList, Calculator, FileText, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/notification-bell";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarInteractionContext } from "@/components/sidebar-interaction-context";
import { createSidebarHoverController } from "@/lib/sidebarHover";

type Item = { href: string; label: string; icon: ElementType; exact?: boolean };

function RailLink({ item, location }: { item: Item; location: string }) {
  const { href, label, icon: Icon, exact } = item;
  const active = exact
    ? location === href
    : location === href || (location.startsWith(href + "/") && !(href === "/deals" && location.startsWith("/deals/rate-converter")));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} data-active={active} className="desktop-rail-item">
          <Icon size={18} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <div className="my-2 w-6 border-t border-sidebar-border" aria-hidden />;
}

function Rail({ pinned, onTogglePin }: { pinned: boolean; onTogglePin: () => void }) {
  const [location, navigate] = useLocation();
  const { signOut } = useClerk();
  const { data: me } = useGetMe();
  const isAdmin = me?.role === "admin";
  const isManagerOrAdmin = me?.role === "manager" || isAdmin;
  const isRep = me?.role === "rep";

  // Same items, order, icons and permissions as SidebarContent.
  const main: Item[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/leads", label: "Leads", icon: Users },
    { href: "/deals", label: "Deals", icon: Briefcase },
    { href: "/deals/rate-points", label: "Rate & Points", icon: Calculator },
    { href: "/documents", label: "Documents", icon: FileText },
    ...(isManagerOrAdmin ? [{ href: "/campaigns", label: "Campaigns", icon: Mail }] : []),
  ];
  const marketing: Item[] = [
    { href: "/email/templates", label: "Email Templates", icon: Mail },
    { href: "/drip/sequences", label: "Drip Sequences", icon: Zap },
    ...(isAdmin || isRep ? [{ href: "/lenders", label: "Partners", icon: Building2 }] : []),
    ...(isAdmin ? [{ href: "/flyer-templates", label: "Flyer Templates", icon: Megaphone }] : []),
  ];
  const admin: Item[] = [
    { href: "/credit/compliance", label: "Credit Compliance", icon: ShieldCheck },
    { href: "/governance", label: "Data Governance", icon: ShieldCheck },
    { href: "/workflow-rules", label: "Workflow Rules", icon: GitBranch },
    { href: "/system-health", label: "System Health", icon: Activity },
    { href: "/admin/usfa-intake", label: "USFA Intake", icon: ClipboardList },
    { href: "/settings", label: "Settings", icon: SettingsIcon, exact: true },
  ];
  const PinIcon = pinned ? PanelLeftClose : PanelLeftOpen;

  return (
    <div className="flex h-full w-14 flex-col items-center py-2">
      <div data-sidebar-hover-exempt className="flex h-12 w-full items-center justify-center border-b border-sidebar-border pb-1">
        <NotificationBell />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-3" aria-label="Primary">
        {main.map((i) => <RailLink key={i.href} item={i} location={location} />)}
        {(isManagerOrAdmin || isRep) && (
          <>
            <Divider />
            {marketing.map((i) => <RailLink key={i.href} item={i} location={location} />)}
            {isManagerOrAdmin && (
              <>
                <Divider />
                <RailLink item={{ href: "/leads/stale", label: "Stale Leads", icon: Activity }} location={location} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Import Leads"
                      className="desktop-rail-item"
                      onClick={() => {
                        if (location.split("?")[0] === "/leads") window.dispatchEvent(new CustomEvent("open-import-dialog"));
                        else navigate("/leads?import=1");
                      }}
                    >
                      <Upload size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Import Leads</TooltipContent>
                </Tooltip>
              </>
            )}
          </>
        )}
        {isAdmin && (
          <>
            <Divider />
            {admin.map((i) => <RailLink key={i.href} item={i} location={location} />)}
          </>
        )}
      </nav>
      <div data-sidebar-hover-exempt className="flex flex-col items-center gap-1 border-t border-sidebar-border pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="desktop-rail-item" aria-label="Sign Out" onClick={() => signOut()}>
              <LogOut size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Sign Out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="desktop-rail-item" aria-label="Pin sidebar open" aria-pressed={pinned} onClick={onTogglePin}>
              <PinIcon size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Pin sidebar (Ctrl/Cmd+B)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function DesktopSidebar({
  pinned, onTogglePin, expanded,
}: { pinned: boolean; onTogglePin: () => void; expanded: ReactNode }) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const expandedRef = useRef<HTMLDivElement>(null);
  const layers = useRef(new Set<symbol>());
  const pressed = useRef(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const focusTransfer = useRef<string | null>(null);
  const keyboardInside = useCallback(() => {
    const active = document.activeElement;
    return Boolean(active && sidebarRef.current?.contains(active) && active.matches(":focus-visible"));
  }, []);
  const [hover] = useState(() => createSidebarHoverController(setHoverOpen, (opening) => {
    if (pinnedRef.current || pressed.current || layers.current.size) return false;
    return opening
      ? Boolean(sidebarRef.current?.matches(":hover"))
      : !sidebarRef.current?.matches(":hover") && !keyboardInside();
  }));
  const setLayerOpen = useCallback((owner: symbol, open: boolean) => {
    if (open) {
      layers.current.add(owner);
      hover.cancel();
    } else if (layers.current.delete(owner) && !layers.current.size) {
      hover.request(false);
    }
  }, [hover]);
  const interaction = useMemo(() => ({ setLayerOpen }), [setLayerOpen]);
  useEffect(() => () => hover.cancel(), [hover]);
  useEffect(() => {
    hover.cancel();
    // Pointer-leave intents are blocked while pinned. Reconcile them when
    // unpinning, unless current pointer/focus/portal ownership still holds us.
    if (!pinned) hover.request(false);
  }, [pinned, hover]);
  useEffect(() => {
    const finishPress = () => {
      if (!pressed.current) return;
      pressed.current = false;
      if (!sidebarRef.current?.matches(":hover")) hover.request(false);
    };
    window.addEventListener("pointerup", finishPress);
    window.addEventListener("pointercancel", finishPress);
    return () => {
      window.removeEventListener("pointerup", finishPress);
      window.removeEventListener("pointercancel", finishPress);
    };
  }, [hover]);
  useLayoutEffect(() => {
    if (!(pinned || hoverOpen) || !focusTransfer.current) return;
    const label = focusTransfer.current;
    focusTransfer.current = null;
    const controls = expandedRef.current?.querySelectorAll<HTMLElement>("a[href], button");
    const target = label === "sidebar-pin"
      ? expandedRef.current?.querySelector<HTMLElement>(`[aria-label="${pinned ? "Unpin sidebar" : "Pin sidebar open"}"]`)
      : Array.from(controls ?? []).find(el => (el.getAttribute("aria-label") || el.textContent?.trim()) === label);
    target?.focus();
  }, [hoverOpen, pinned]);
  const togglePin = () => {
    if (keyboardInside()) focusTransfer.current = "sidebar-pin";
    hover.setOpen(Boolean(sidebarRef.current?.matches(":hover")) || keyboardInside());
    onTogglePin();
  };
  const trackPointer = (target: EventTarget | null) => {
    if (pinned || layers.current.size || pressed.current) return;
    // A later pointer hover must not replay a previous keyboard focus handoff.
    focusTransfer.current = null;
    const element = target instanceof Element ? target : null;
    if (element?.closest("[data-sidebar-hover-exempt]")) hover.cancel();
    else if (element && sidebarRef.current?.contains(element)) hover.request(true);
  };
  const expandedVisible = pinned || hoverOpen;

  const pinBar = (
    <div className="flex shrink-0 items-center justify-end border-t border-sidebar-border px-3 py-1.5">
      <button
        type="button"
        onClick={togglePin}
        aria-pressed={pinned}
        aria-label={pinned ? "Unpin sidebar" : "Pin sidebar open"}
        className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      >
        {pinned ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        {pinned ? "Unpin" : "Pin open"}
        <kbd className="font-mono rounded bg-sidebar-foreground/10 px-1 text-[10px]">Ctrl B</kbd>
      </button>
    </div>
  );
  const expandedTree = (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">{expanded}</div>
      {pinBar}
    </div>
  );

  return (
    <SidebarInteractionContext.Provider value={interaction}>
    <aside
      ref={sidebarRef}
      data-testid="desktop-sidebar"
      data-pinned={pinned}
      data-open={pinned || hoverOpen}
      onPointerEnter={(e) => trackPointer(e.target)}
      onPointerMove={(e) => trackPointer(e.target)}
      onPointerLeave={() => hover.request(false)}
      onPointerDownCapture={() => { pressed.current = true; hover.cancel(); }}
      onFocusCapture={(e) => {
        // Pointer focus must not place the overlay over a rail control between
        // mouse-down and click. Keyboard focus can expand it immediately.
        if (e.target.matches(":focus-visible") && e.target.closest("[data-sidebar-surface='rail']") && e.target.getAttribute("aria-label") === "Pin sidebar open") {
          focusTransfer.current = "sidebar-pin";
        }
        if (!layers.current.size && e.target.matches(":focus-visible") && !e.target.closest("[data-sidebar-hover-exempt]")) {
          if (e.target.closest("[data-sidebar-surface='rail']")) {
            focusTransfer.current = e.target.getAttribute("aria-label") || e.target.textContent?.trim() || null;
          }
          hover.setOpen(true);
        }
      }}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hover.request(false); }}
      onKeyDown={(e) => {
        // Do not unmount a rail-owned panel via the global pin shortcut.
        if (layers.current.size && !e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") e.preventDefault();
        if (e.key === "Escape" && !pinned && !layers.current.size) hover.setOpen(false);
      }}
      className="desktop-rail fixed inset-y-0 left-0 z-[var(--z-sidebar)] border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      {!pinned && <div className="h-full" data-sidebar-surface="rail" inert={expandedVisible} aria-hidden={expandedVisible}>
        <Rail pinned={false} onTogglePin={togglePin} />
      </div>}
      <div
        ref={expandedRef}
        data-sidebar-surface="expanded"
        hidden={!expandedVisible}
        inert={!expandedVisible}
        className={pinned ? "h-full" : "desktop-rail-overlay glass-surface bg-sidebar text-sidebar-foreground"}
      >{expandedTree}</div>
    </aside>
    </SidebarInteractionContext.Provider>
  );
}
