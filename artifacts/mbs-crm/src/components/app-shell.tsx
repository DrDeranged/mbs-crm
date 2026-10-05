import { useState } from "react";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { useDesktopSidebarPin, useIsDesktop } from "@/hooks/use-desktop-sidebar";
import { Link, useLocation } from "wouter";
import { CommandPalette } from "@/components/command-palette";
import { useClerk, useUser } from "@clerk/react";
import {
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Upload,
  Menu,
  Mail,
  Zap,
  Building2,
  Megaphone,
  ShieldCheck,
  GitBranch,
  Search,
  Activity,
  Briefcase,
  BookOpen,
  ChevronDown,
  FileDown,
  ClipboardList,
  Calculator,
  FileText,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetMe } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSidebarLayer } from "@/components/sidebar-interaction-context";
import { getUserDisplayName } from "@/lib/utils";
import { getApiBaseUrl } from "@/lib/apiBase";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppShellProps {
  children: React.ReactNode;
}

function SidebarContent({ onNavigate, showSearch = true }: { onNavigate?: () => void; showSearch?: boolean }) {
  const setMenuOpen = useSidebarLayer();
  const [location, navigate] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: currentUser } = useGetMe();

  const isAdmin = currentUser?.role === "admin";
  const isManagerOrAdmin = currentUser?.role === "manager" || isAdmin;

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/leads", label: "Leads", icon: Users },
    { href: "/deals", label: "Deals", icon: Briefcase },
    { href: "/deals/rate-points", label: "Rate & Points", icon: Calculator },
    { href: "/documents", label: "Documents", icon: FileText },
    ...(isManagerOrAdmin ? [{ href: "/campaigns", label: "Campaigns", icon: Mail }] : []),
  ];

  const navLink = (href: string, label: string, Icon: React.ElementType, exact = false) => {
    const isActive = exact
      ? location === href
      : location === href || (location.startsWith(href + "/") && !(href === "/deals" && location.startsWith("/deals/rate-converter")));
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"
        }`}
        style={isActive ? { borderLeft: "3px solid hsl(var(--sidebar-primary))", paddingLeft: "calc(0.75rem - 3px)" } : { borderLeft: "3px solid transparent", paddingLeft: "calc(0.75rem - 3px)" }}
      >
        <Icon size={16} className={`shrink-0 ${isActive ? "text-sidebar-primary" : ""}`} />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  const sectionLabel = (text: string) => (
    <div className="truncate px-3 mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/70">
      {text}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5 flex-shrink-0 gap-2">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 flex-1 min-w-0">
          <BrandLogo variant="reverse" className="w-[120px]" imageClassName="h-auto w-[120px]" />
        </Link>
        <NotificationBell />
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-auto py-4 px-3">
        <nav className="space-y-0.5">
          {navItems.map((item) => navLink(item.href, item.label, item.icon))}

          {(isManagerOrAdmin || currentUser?.role === "rep") && (
            <>
              <div className="pt-4 pb-1">
                <div className="border-t border-sidebar-border" />
              </div>
              {sectionLabel("Marketing")}
              {navLink("/email/templates", "Email Templates", Mail)}
              {navLink("/drip/sequences", "Drip Sequences", Zap)}
              {(isAdmin || currentUser?.role === "rep") && navLink("/lenders", "Partners", Building2)}
              {isAdmin && navLink("/flyer-templates", "Flyer Templates", Megaphone)}
              {isManagerOrAdmin && (
                <>
                  <div className="pt-4 pb-1">
                    <div className="border-t border-sidebar-border" />
                  </div>
                  {sectionLabel("Management")}
                  {navLink("/leads/stale", "Stale Leads", Activity)}
                  <button
                    onClick={() => {
                      if (location.split("?")[0] === "/leads") {
                        window.dispatchEvent(new CustomEvent("open-import-dialog"));
                      } else {
                        navigate("/leads?import=1");
                      }
                      onNavigate?.();
                    }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white cursor-pointer w-full text-left"
                    style={{ borderLeft: "3px solid transparent", paddingLeft: "calc(0.75rem - 3px)" }}
                  >
                    <Upload size={16} />
                    Import Leads
                  </button>
                </>
              )}
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-4 pb-1">
                <div className="border-t border-sidebar-border" />
              </div>
              {sectionLabel("Administration")}
              {navLink("/credit/compliance", "Credit Compliance", ShieldCheck)}
              {isAdmin && navLink("/governance", "Data Governance", ShieldCheck)}
              {navLink("/workflow-rules", "Workflow Rules", GitBranch)}
              {navLink("/system-health", "System Health", Activity)}
              {navLink("/admin/usfa-intake", "USFA Intake", ClipboardList)}
              {navLink("/settings", "Settings", SettingsIcon, true)}
            </>
          )}
        </nav>
      </div>

      {/* Cmd+K search trigger */}
      {showSearch && <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="flex items-center gap-2 w-full rounded-xl border border-sidebar-border bg-white/5 px-3 py-2 text-xs text-sidebar-foreground/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Open command palette"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="font-mono bg-sidebar-foreground/10 px-1.5 py-0.5 rounded text-[10px]">⌘K</kbd>
        </button>
      </div>}

      {/* User footer */}
      <div className="border-t border-sidebar-border p-4 flex-shrink-0">
        <DropdownMenu onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mb-3 flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              aria-label="Open user menu"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden flex-shrink-0 text-xs font-semibold ">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <span>{user?.firstName?.charAt(0) || "U"}</span>
                )}
              </div>
              <div className="flex flex-1 flex-col truncate min-w-0">
                <span className="text-sm font-semibold truncate text-sidebar-foreground">{getUserDisplayName(user)}</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/70">Account menu</span>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-sidebar-foreground/70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56 glass-surface">
            <DropdownMenuLabel className="text-muted-foreground">Workspace</DropdownMenuLabel>
            <DropdownMenuItem asChild className="text-popover-foreground focus:bg-accent focus:text-accent-foreground">
              <Link href="/help/rep-quickstart" onClick={onNavigate}>
                <BookOpen className="h-4 w-4 text-success" />
                Rep Quickstart
              </Link>
            </DropdownMenuItem>
            {(currentUser?.role === "rep" || currentUser?.role === "admin") && currentUser.id && (
              <DropdownMenuItem asChild className="text-popover-foreground focus:bg-accent focus:text-accent-foreground">
                <a href={`${getApiBaseUrl()}/users/${currentUser.id}/application-form.pdf`}>
                  <FileDown className="h-4 w-4 text-success" />
                  Download blank application PDF
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem asChild className="text-popover-foreground focus:bg-accent focus:text-accent-foreground cursor-pointer">
              <button onClick={() => window.dispatchEvent(new CustomEvent('mbs-prompt-install'))} className="w-full text-left flex items-center">
                <Download className="h-4 w-4 mr-2 text-success" />
                Install app
              </button>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Signed in as {getUserDisplayName(user)}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 bg-transparent border-white/15 text-sidebar-foreground/70 hover:bg-white/10 hover:text-white hover:border-white/25"
          onClick={() => signOut()}
        >
          <LogOut size={14} />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [location] = useLocation();
  const isDealsBoard = location.split("?")[0] === "/deals";
  const isRecordDetail = /^\/(?:leads|deals)\/\d+(?:\/|$)/.test(location);
  const isDesktop = useIsDesktop();
  const { user: clerkUser } = useUser();
  const { pinned, setPinned } = useDesktopSidebarPin(clerkUser?.id, isDesktop);

  if (isDesktop) {
    return (
      <div className="desktop-app-shell flex h-dvh w-full overflow-hidden bg-background">
        <CommandPalette />
        <DesktopSidebar pinned={pinned} onTogglePin={() => setPinned((p) => !p)} expanded={<SidebarContent showSearch={pinned} />} />
        <main className={`min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden ${pinned ? "ml-64" : "ml-14"}`}>
          <div data-scrolled={scrolled} className="glass-header flex h-14 items-center justify-between gap-4 border-b border-border bg-surface px-6 lg:px-8 flex-shrink-0">
            <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">Operations workspace</span>
            <div className="flex items-center gap-4">
              {!pinned && (
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
                  className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Open command palette"
                >
                  <Search size={13} />
                  <span>Search…</span>
                  <kbd className="font-mono bg-foreground/10 px-1.5 py-0.5 rounded text-[10px]">⌘K</kbd>
                </button>
              )}
              <ThemeToggle />
              <BrandLogo className="h-7" imageClassName="h-7 w-auto" />
            </div>
          </div>
          <div data-desktop-content className="min-h-0 min-w-0 flex-1 overflow-auto" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`flex w-full bg-background ${isRecordDetail ? "h-dvh overflow-hidden" : "min-h-screen"}`}>
      <CommandPalette />
      {/* Desktop Sidebar */}
      <aside className={`hidden md:fixed md:inset-y-0 md:left-0 md:z-[var(--z-sidebar)] md:flex md:w-64 md:flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground  ${
        isDealsBoard ? "xl:w-40 2xl:w-64" : ""
      }`}>
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className={`flex-1 md:ml-64 flex flex-col overflow-hidden ${isRecordDetail ? "min-h-0" : "min-h-screen"} ${
        isDealsBoard ? "xl:ml-40 2xl:ml-64" : ""
      }`}>
        <div data-scrolled={scrolled} className="glass-header hidden md:flex h-14 items-center justify-between border-b border-border bg-surface px-6 lg:px-8 flex-shrink-0">
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">Operations workspace</span>
          <BrandLogo className="h-7" imageClassName="h-7 w-auto" />
        </div>
        {/* Mobile top bar */}
        <div data-scrolled={scrolled} className="glass-header flex md:hidden h-14 items-center border-b border-border bg-surface text-foreground px-4 gap-3 flex-shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-foreground hover:bg-muted">
                <Menu size={20} />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center flex-1 min-w-0">
            <BrandLogo imageClassName="h-7 w-auto" />
          </div>
          <NotificationBell onDark={false} />
        </div>

        <div className="flex-1 overflow-auto pb-24 md:pb-6" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}>
          {children}
        </div>
      </main>
    </div>
  );
}
