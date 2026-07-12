import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Users,
  Mail,
  Zap,
  Building2,
  Megaphone,
  ShieldCheck,
  GitBranch,
  Settings,
  Plus,
  Upload,
} from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { data: me } = useGetMe();

  const isAdmin = me?.role === "admin";
  const isManagerOrAdmin = me?.role === "manager" || isAdmin;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || e.key === "/") {
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target as HTMLElement)?.isContentEditable
        ) {
          if (e.key === "/") return;
        }
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const custom = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener("open-command-palette", custom);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("open-command-palette", custom);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/leads")}>
            <Users />
            Leads
          </CommandItem>
          {isManagerOrAdmin && (
            <>
              <CommandItem onSelect={() => go("/email/templates")}>
                <Mail />
                Email Templates
              </CommandItem>
              <CommandItem onSelect={() => go("/drip/sequences")}>
                <Zap />
                Drip Sequences
              </CommandItem>
            </>
          )}
          {isAdmin && (
            <>
              <CommandItem onSelect={() => go("/lenders")}>
                <Building2 />
                Lenders
              </CommandItem>
              <CommandItem onSelect={() => go("/flyer-templates")}>
                <Megaphone />
                Flyer Templates
              </CommandItem>
            </>
          )}
          {isAdmin && (
            <>
              <CommandItem onSelect={() => go("/credit/compliance")}>
                <ShieldCheck />
                Credit Compliance
              </CommandItem>
              <CommandItem onSelect={() => go("/workflow-rules")}>
                <GitBranch />
                Workflow Rules
              </CommandItem>
              <CommandItem onSelect={() => go("/settings")}>
                <Settings />
                Settings
              </CommandItem>
            </>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Quick Actions">
          <CommandItem onSelect={() => { setOpen(false); navigate("/leads/new"); }}>
            <Plus />
            New Lead
          </CommandItem>
          {isManagerOrAdmin && (
            <CommandItem
              onSelect={() => {
                setOpen(false);
                window.dispatchEvent(new CustomEvent("open-import-dialog"));
              }}
            >
              <Upload />
              Import Leads
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
