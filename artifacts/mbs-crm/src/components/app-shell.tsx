import { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetMe } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/notification-bell";

interface AppShellProps {
  children: React.ReactNode;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location, navigate] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: currentUser } = useGetMe();

  const isAdmin = currentUser?.role === "admin";
  const isManagerOrAdmin = currentUser?.role === "manager" || isAdmin;

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/leads", label: "Leads", icon: Users },
  ];

  const navLink = (href: string, label: string, Icon: React.ElementType, exact = false) => {
    const isActive = exact ? location === href : location === href || location.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
          isActive
            ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
            : "text-sidebar-foreground/70 hover:bg-white/8 hover:text-white"
        }`}
        style={isActive ? { borderLeft: "3px solid #17A567", paddingLeft: "calc(0.75rem - 3px)" } : { borderLeft: "3px solid transparent", paddingLeft: "calc(0.75rem - 3px)" }}
      >
        <Icon size={16} className={isActive ? "text-[#17A567]" : ""} />
        {label}
      </Link>
    );
  };

  const sectionLabel = (text: string) => (
    <div className="px-3 mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
      {text}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5 flex-shrink-0 gap-2">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 flex-1 min-w-0">
          <BrandLogo variant="chip" alt="MBS dashboard" imageClassName="h-7" />
        </Link>
        <NotificationBell />
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-auto py-4 px-3">
        <nav className="space-y-0.5">
          {navItems.map((item) => navLink(item.href, item.label, item.icon))}

          {isManagerOrAdmin && (
            <>
              <div className="pt-4 pb-1">
                <div className="border-t border-white/10" />
              </div>
              {sectionLabel("Marketing")}
              {navLink("/email/templates", "Email Templates", Mail)}
              {navLink("/drip/sequences", "Drip Sequences", Zap)}
              {isAdmin && navLink("/lenders", "Lenders", Building2)}
              {isAdmin && navLink("/flyer-templates", "Flyer Templates", Megaphone)}
              <div className="pt-4 pb-1">
                <div className="border-t border-white/10" />
              </div>
              {sectionLabel("Management")}
              <button
                onClick={() => {
                  if (location.split("?")[0] === "/leads") {
                    window.dispatchEvent(new CustomEvent("open-import-dialog"));
                  } else {
                    navigate("/leads?import=1");
                  }
                  onNavigate?.();
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 text-sidebar-foreground/70 hover:bg-white/8 hover:text-white cursor-pointer w-full text-left"
                style={{ borderLeft: "3px solid transparent", paddingLeft: "calc(0.75rem - 3px)" }}
              >
                <Upload size={16} />
                Import Leads
              </button>
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-4 pb-1">
                <div className="border-t border-white/10" />
              </div>
              {sectionLabel("Administration")}
              {navLink("/credit/compliance", "Credit Compliance", ShieldCheck)}
              {isAdmin && navLink("/governance", "Data Governance", ShieldCheck)}
              {navLink("/workflow-rules", "Workflow Rules", GitBranch)}
              {navLink("/system-health", "System Health", Activity)}
              {navLink("/settings", "Settings", SettingsIcon, true)}
            </>
          )}
        </nav>
      </div>

      {/* Cmd+K search trigger */}
      <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          className="flex items-center gap-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-sidebar-foreground/60 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Open command palette"
        >
          <Search size={13} />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="font-mono bg-sidebar-foreground/10 px-1.5 py-0.5 rounded text-[10px]">⌘K</kbd>
        </button>
      </div>

      {/* User footer */}
      <div className="border-t border-white/10 p-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3 px-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden flex-shrink-0 text-xs font-semibold shadow-sm">
            {user?.imageUrl ? (
              <img src={user.imageUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span>{user?.firstName?.charAt(0) || "U"}</span>
            )}
          </div>
          <div className="flex flex-col truncate min-w-0">
            <span className="text-sm font-semibold truncate text-sidebar-foreground">{user?.fullName || "User"}</span>
            <span className="text-xs text-sidebar-foreground/50 truncate">{user?.primaryEmailAddress?.emailAddress}</span>
          </div>
        </div>
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

  return (
    <div className="flex min-h-screen w-full bg-background">
      <CommandPalette />
      {/* Desktop Sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-10 md:flex md:w-64 md:flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[8px_0_28px_rgba(14,42,71,.08)]">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen overflow-hidden">
        <div className="hidden md:flex h-14 items-center justify-between border-b border-border bg-white px-6 lg:px-8 flex-shrink-0">
          <span className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#46586C]">Operations workspace</span>
          <span className="text-sm font-medium text-[#0E2A47]">MBS CRM</span>
        </div>
        {/* Mobile top bar */}
        <div className="flex md:hidden h-14 items-center border-b border-border bg-white text-foreground px-4 gap-3 flex-shrink-0 shadow-sm">
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
            <BrandLogo variant="raw" alt="MBS dashboard" imageClassName="h-6" />
          </div>
          <NotificationBell onDark={false} />
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
