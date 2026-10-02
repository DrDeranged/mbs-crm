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
  Briefcase,
} from "lucide-react";
import {
  getListDealsQueryKey,
  getListLeadsQueryKey,
  useGetMe,
  useListDeals,
  useListLeads,
} from "@workspace/api-client-react";
import { formatDealIdentity, formatLeadIdentity } from "@/lib/recordIdentity";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [location, navigate] = useLocation();
  const { data: me } = useGetMe();

  const isAdmin = me?.role === "admin";
  const isManagerOrAdmin = me?.role === "manager" || isAdmin;
  const canSearchRecords = me?.role === "rep" || isManagerOrAdmin;
  const searchTerm = search.trim();
  const leadSearchParams = { search: searchTerm || undefined, limit: 8 };
  const dealSearchParams = { search: searchTerm || undefined, page: 1, limit: 8 };
  const { data: leadSearchData, isFetching: isSearchingLeads, error: leadSearchError } = useListLeads(leadSearchParams, {
    query: { queryKey: getListLeadsQueryKey(leadSearchParams), enabled: open && canSearchRecords && searchTerm.length >= 2 },
  });
  const { data: dealSearchData, isFetching: isSearchingDeals, error: dealSearchError } = useListDeals(dealSearchParams, {
    query: { queryKey: getListDealsQueryKey(dealSearchParams), enabled: open && canSearchRecords && searchTerm.length >= 2 },
  });
  const matchingLeads = leadSearchData?.leads ?? [];
  const matchingDeals = dealSearchData?.deals ?? [];

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
    setSearch("");
    navigate(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch(""); }}>
      <CommandInput value={search} onValueChange={setSearch} placeholder="Search pages, leads, deals, and actions…" />
      <CommandList>
        <CommandEmpty>{searchTerm.length >= 2 && (isSearchingLeads || isSearchingDeals) ? "Searching records…" : "No results found."}</CommandEmpty>

        {canSearchRecords && searchTerm.length >= 2 && (
          <>
            {matchingLeads.length > 0 && (
              <CommandGroup heading="Leads">
                {matchingLeads.map((lead) => {
                  const identity = lead.entityLabel || formatLeadIdentity(lead);
                  return (
                    <CommandItem
                      key={`lead-${lead.id}`}
                      value={`${identity} ${lead.companyName ?? ""} ${lead.contactName ?? ""} ${lead.firstName ?? ""} ${lead.lastName ?? ""} ${lead.email ?? ""} ${lead.phone ?? ""}`}
                      onSelect={() => go(`/leads/${lead.id}`)}
                    >
                      <Users />
                      <span className="min-w-0">
                        <span className="block truncate">{identity}</span>
                        {(lead.email || lead.phone) && <span className="block truncate text-xs text-muted-foreground">{[lead.email, lead.phone].filter(Boolean).join(" · ")}</span>}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {matchingDeals.length > 0 && (
              <CommandGroup heading="Deals">
                {matchingDeals.map((deal) => {
                  const identity = deal.entityLabel || formatDealIdentity(deal as any);
                  const customDealName = deal.dealName?.trim() ?? "";
                  return (
                  <CommandItem
                    key={`deal-${deal.id}`}
                    value={`${identity} ${deal.companyName ?? ""} ${deal.contactName ?? ""} ${deal.contactEmail ?? ""} ${deal.contactPhone ?? ""} ${customDealName}`}
                    onSelect={() => go(`/deals/${deal.id}`)}
                  >
                    <Briefcase />
                    <span className="min-w-0">
                      <span className="block truncate">{identity}</span>
                      {customDealName && customDealName !== identity && <span className="block truncate text-xs text-muted-foreground">{customDealName}</span>}
                    </span>
                  </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
            {!matchingLeads.length && !matchingDeals.length && (isSearchingLeads || isSearchingDeals) && (
              <CommandGroup heading="Records"><CommandItem disabled value="searching-records">Searching records…</CommandItem></CommandGroup>
            )}
            {(leadSearchError || dealSearchError) && (
              <CommandGroup heading="Record search">
                <CommandItem disabled value={`record search error ${searchTerm}`}>
                  Some record results could not be loaded. Try again or open the Leads and Deals lists.
                </CommandItem>
              </CommandGroup>
            )}
          </>
        )}

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go("/dashboard")}>
            <LayoutDashboard />
            Dashboard
          </CommandItem>
          <CommandItem onSelect={() => go("/leads")}>
            <Users />
            Leads
          </CommandItem>
          <CommandItem onSelect={() => go("/deals")}>
            <Briefcase />
            Deals
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
                if (location.split("?")[0] === "/leads") {
                  window.dispatchEvent(new CustomEvent("open-import-dialog"));
                } else {
                  navigate("/leads?import=1");
                }
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
