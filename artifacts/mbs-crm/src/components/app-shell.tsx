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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useGetMe } from "@workspace/api-client-react";

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
        className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }`}
      >
        <Icon size={18} />
        {label}
      </Link>
    );
  };

  return (
    <>
      <div className="flex h-14 items-center border-b border-sidebar-border px-4 py-2 flex-shrink-0">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-2 font-bold tracking-tight">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-sidebar-primary text-sidebar-primary-foreground">
            <Briefcase size={18} />
          </div>
          <span>MBS CRM</span>
        </Link>
      </div>

      <div className="flex-1 overflow-auto py-4">
        <nav className="grid gap-1 px-2">
          {navItems.map((item) => navLink(item.href, item.label, item.icon))}

          {isManagerOrAdmin && (
            <>
              <Separator className="my-4 bg-sidebar-border" />
              <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Marketing
              </div>
              {navLink("/email/templates", "Email Templates", Mail)}
              {navLink("/drip/sequences", "Drip Sequences", Zap)}
              {isAdmin && navLink("/lenders", "Lenders", Building2)}
              <Separator className="my-4 bg-sidebar-border" />
              <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Management
              </div>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("open-import-dialog"));
                  onNavigate?.();
                }}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground cursor-pointer w-full text-left"
              >
                <Upload size={18} />
                Import Leads
              </button>
            </>
          )}

          {isAdmin && (
            <>
              <Separator className="my-4 bg-sidebar-border" />
              <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Administration
              </div>
              {navLink("/settings", "Settings", SettingsIcon, true)}
            </>
          )}
        </nav>
      </div>

      <div className="border-t border-sidebar-border p-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground overflow-hidden flex-shrink-0">
            {user?.imageUrl ? (
              <img src={user.imageUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="text-sm font-medium">{user?.firstName?.charAt(0) || "U"}</span>
            )}
          </div>
          <div className="flex flex-col truncate min-w-0">
            <span className="text-sm font-medium truncate">{user?.fullName || "User"}</span>
            <span className="text-xs text-sidebar-foreground/60 truncate">{user?.primaryEmailAddress?.emailAddress}</span>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 bg-transparent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => signOut()}
        >
          <LogOut size={16} />
          Sign Out
        </Button>
      </div>
    </>
  );
}

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-muted/40">
      {/* Desktop Sidebar — hidden on mobile */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-10 md:flex md:w-64 md:flex-col border-r bg-sidebar text-sidebar-foreground">
        <SidebarContent />
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col min-h-screen overflow-hidden">
        {/* Mobile top bar */}
        <div className="flex md:hidden h-14 items-center border-b bg-sidebar text-sidebar-foreground px-4 gap-3 flex-shrink-0">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent">
                <Menu size={20} />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-sidebar-primary text-sidebar-primary-foreground">
              <Briefcase size={16} />
            </div>
            <span>MBS CRM</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
