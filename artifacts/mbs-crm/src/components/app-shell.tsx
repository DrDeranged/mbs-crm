import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import {
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Briefcase,
  Upload,
  Menu,
  Mail,
  Zap,
  Building2,
  Megaphone,
  ShieldCheck,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetMe } from "@workspace/api-client-react";
import { NotificationBell } from "@/components/notification-bell";

interface AppShellProps {
  children: React.ReactNode;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
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
            ? "bg-accent text-accent-foreground"
            : "text-sidebar-foreground/60 hover:bg-accent/50 hover:text-sidebar-foreground"
        }`}
        style={isActive ? { borderLeft: "3px solid hsl(var(--primary))", paddingLeft: "calc(0.75rem - 3px)" } : { borderLeft: "3px solid transparent", paddingLeft: "calc(0.75rem - 3px)" }}
      >
        <Icon size={16} className={isActive ? "text-primary" : ""} />
        {label}
      </Link>
    );
  };

  const sectionLabel = (text: string) => (
    <div className="px-3 mb-1 mt-2 text-xs font-semibold uppercase tracking-widest text-sidebar-foreground/40">
      {text}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-sidebar-border px-5 flex-shrink-0 gap-2">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2.5 font-bold tracking-tight flex-1 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm flex-shrink-0">
            <Briefcase size={16} />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            <span className="text-sm font-bold text-sidebar-foreground">MBS CRM</span>
            <span className="text-xs text-sidebar-foreground/40 font-normal">Business Solutions</span>
          </div>
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
                <div className="border-t border-sidebar-border" />
              </div>
              {sectionLabel("Marketing")}
              {navLink("/email/templates", "Email Templates", Mail)}
              {navLink("/drip/sequences", "Drip Sequences", Zap)}
              {isAdmin && navLink("/lenders", "Lenders", Building2)}
              {isAdmin && navLink("/flyer-templates", "Flyer Templates", Megaphone)}
              <div className="pt-4 pb-1">
                <div className="border-t border-sidebar-border" />
              </div>
              {sectionLabel("Management")}
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-import-dialog"));
                  onNavigate?.();
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 text-sidebar-foreground/60 hover:bg-accent/50 hover:text-sidebar-foreground cursor-pointer w-full text-left"
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
                <div className="border-t border-sidebar-border" />
              </div>
              {sectionLabel("Administration")}
              {navLink("/credit/compliance", "Credit Compliance", ShieldCheck)}
              {navLink("/workflow-rules", "Workflow Rules", GitBranch)}
              {navLink("/settings", "Settings", SettingsIcon, true)}
            </>
          )}
        </nav>
      </div>

      {/* User footer */}
      <div className="border-t border-sidebar-border p-4 flex-shrink-0">
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
          className="w-full justify-start gap-2 bg-transparent border-sidebar-border text-sidebar-foreground/60 hover:bg-accent hover:text-accent-foreground hover:border-accent-border"
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
      {/* Desktop Sidebar */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-10 md:flex md:w-64 md:flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex md:hidden h-14 items-center border-b border-sidebar-border bg-sidebar text-sidebar-foreground px-4 gap-3 flex-shrink-0 shadow-sm">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-accent">
                <Menu size={20} />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-bold tracking-tight flex-1 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground flex-shrink-0">
              <Briefcase size={14} />
            </div>
            <span className="text-sm font-bold">MBS CRM</span>
          </div>
          <NotificationBell />
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
