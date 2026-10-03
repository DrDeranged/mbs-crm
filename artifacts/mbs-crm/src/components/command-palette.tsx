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
  Calculator,
  FileText,
  Activity,
  ClipboardList,
  BookOpen,
} from "lucide-react";
import {
  getListDealsQueryKey,
  getListLeadsQueryKey,
  getListLendersQueryKey,
  useGetMe,
  useListDeals,
  useListLeads,
  useListLenders,
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
  const canSearchPartners = isAdmin || me?.role === "rep";
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
  // Partners (direct lenders and inbound/outbound brokers) share the existing
  // authorized directory. Do not fetch it for roles without its navigation.
  const { data: partners, isFetching: isSearchingPartners, error: partnerSearchError } = useListLenders({
    query: { queryKey: getListLendersQueryKey(), enabled: open && canSearchPartners && searchTerm.length >= 2 },
  });
  const matchingPartners = (canSearchPartners ? partners ?? [] : []).filter(partner =>
    partner.isActive && [partner.name, partner.contactName, partner.contactEmail, partner.phone]
      .some(value => value?.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase())),
  ).slice(0, 8);
  const searchPending = isSearchingLeads || isSearchingDeals || (canSearchPartners && isSearchingPartners);
  const searchFailed = leadSearchError || dealSearchError || (canSearchPartners && partnerSearchError);

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
      <CommandInput value={search} onValueChange={setSearch} placeholder="Search pages, leads, deals, lenders, partners, and actions…" />
      <CommandList>
        <CommandEmpty>{searchTerm.length >= 2 && searchPending ? "Searching records…" : searchFailed ? "Search incomplete. Some records could not be loaded." : "No results found."}</CommandEmpty>

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
            {(["Lenders", "Partners"] as const).map(group => {
              const matches = matchingPartners.filter(partner =>
                group === "Lenders" ? !partner.partnerType || partner.partnerType === "direct_lender" : partner.partnerType !== "direct_lender" && !!partner.partnerType,
              );
              return matches.length > 0 && (
                <CommandGroup key={group} heading={group}>
                  {matches.map(partner => (
                    <CommandItem
                      key={`partner-${partner.id}`}
                      value={`${partner.name} ${partner.contactName ?? ""} ${partner.contactEmail ?? ""} ${partner.phone ?? ""}`}
                      onSelect={() => go(`/lenders?partner=${partner.id}`)}
                    >
                      <Building2 />
                      <span className="min-w-0">
                        <span className="block truncate">{partner.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[partner.contactName, partner.contactEmail, partner.phone].filter(Boolean).join(" · ") || "Contact unavailable"}
                        </span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
            {!matchingLeads.length && !matchingDeals.length && !matchingPartners.length && searchPending && (
              <CommandGroup heading="Records"><CommandItem disabled value={`searching-records ${searchTerm}`}>Searching records…</CommandItem></CommandGroup>
            )}
            {searchFailed && (
              <CommandGroup heading="Record search">
                <CommandItem disabled value={`record search error ${searchTerm}`}>
                  Some record results could not be loaded. Try again or open the relevant record list.
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
          <CommandItem onSelect={() => go("/deals/rate-points")}><Calculator />Rate &amp; Points</CommandItem>
          <CommandItem onSelect={() => go("/documents")}><FileText />Documents</CommandItem>
          <CommandItem onSelect={() => go("/help/rep-quickstart")}><BookOpen />Rep Quickstart</CommandItem>
          {isManagerOrAdmin && <CommandItem onSelect={() => go("/campaigns")}><Mail />Campaigns</CommandItem>}
          {canSearchRecords && (
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
          {canSearchPartners && (
            <CommandItem value="Lenders Partners" onSelect={() => go("/lenders")}>
              <Building2 />Partners (Lenders)
            </CommandItem>
          )}
          {isAdmin && (
            <>
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
              <CommandItem onSelect={() => go("/governance")}><ShieldCheck />Data Governance</CommandItem>
              <CommandItem onSelect={() => go("/system-health")}><Activity />System Health</CommandItem>
              <CommandItem onSelect={() => go("/admin/usfa-intake")}><ClipboardList />USFA Intake</CommandItem>
              <CommandItem onSelect={() => go("/settings")}>
                <Settings />
                Settings
              </CommandItem>
            </>
          )}
          {isManagerOrAdmin && <CommandItem onSelect={() => go("/leads/stale")}><Activity />Stale Leads</CommandItem>}
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
