import { useState } from "react";
import { Link, useLocation } from "wouter";
import type { Lead } from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";
import { ArrowUpDown, Plus, Search, Upload, Users, Info } from "lucide-react";
import { cn, getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/searchable-select";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { formatLeadIdentity } from "@/lib/recordIdentity";
import { PhoneLink, EmailLink } from "@/components/phone-link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  leads: Lead[] | undefined;
  isLoading: boolean;
  unavailable: boolean;
  skeletonRows: number;
  hasFilters: boolean;
  isRep: boolean;
  isManagerOrAdmin: boolean;
  isStaleView: boolean;
  selectedIds: Set<number>;
  allPageSelected: boolean;
  users: { id: number; name?: string | null; email?: string | null }[] | undefined;
  assignPending: boolean;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onSingleAssign: (leadId: number, repId: string) => void;
  onToggleActivitySort: () => void;
  onClearFilters: () => void;
  onImport: () => void;
}

const formatStatus = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

function createdByLabel(lead: Lead) {
  const fallback = lead.leadSource === "qr-card" ? "QR-card intake" : lead.leadSource === "website" ? "Website intake" : "System";
  return getUserDisplayName(lead.createdBy, fallback);
}

/** Desktop record grid: grouped fields with continuous, viewport-independent fetching. */
export function LeadsFitTable(p: Props) {
  const [, navigate] = useLocation();
  const [expandedLead, setExpandedLead] = useState<Lead | null>(null);
  const cols = p.isManagerOrAdmin ? 7 : 6;
  const detail = (id: number) => `/leads/${id}`;

  const empty = (
    p.hasFilters ? (
      <Empty className="py-6 border-0">
        <EmptyMedia variant="icon"><Search className="h-5 w-5" /></EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No leads match</EmptyTitle>
          <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <button onClick={p.onClearFilters} className="text-sm text-info underline underline-offset-4 hover:opacity-80">Clear all filters</button>
        </EmptyContent>
      </Empty>
    ) : p.isRep ? (
      <Empty className="py-6 border-0">
        <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No leads assigned to you yet</EmptyTitle>
          <EmptyDescription>Leads assigned to you will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      <Empty className="py-6 border-0">
        <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No leads yet</EmptyTitle>
          <EmptyDescription>Add your first lead manually or import a list to get started.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap gap-2 justify-center">
            <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-solid px-4 text-sm font-medium text-white shadow hover:bg-sidebar-accent">
              <Plus className="mr-2 h-4 w-4" />New Lead
            </Link>
            {p.isManagerOrAdmin && (
              <button onClick={p.onImport} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
                <Upload className="mr-2 h-4 w-4" />Import
              </button>
            )}
          </div>
        </EmptyContent>
      </Empty>
    )
  );

  const showEmpty = !p.isLoading && !p.unavailable && p.leads?.length === 0;

  return (
    <>
      <table className="leads-fit-table text-sm" data-testid="table-leads-fit">
        <colgroup>
          {p.isManagerOrAdmin && <col style={{ width: "5%" }} />}
          <col style={{ width: "18%" }} />
          <col style={{ width: "23%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "8%" }} />
          <col />
        </colgroup>
        <thead className="bg-muted">
          <tr className="border-b">
            {p.isManagerOrAdmin && (
              <th className="px-2 text-left align-middle">
                <Checkbox checked={p.allPageSelected} onCheckedChange={p.onToggleSelectAll} aria-label="Select all" />
              </th>
            )}
            <th title="Lead and company" className="px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Lead</th>
            <th className="px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Contact</th>
            <th className="px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Status</th>
            <th title="Assigned representative and creator" className="px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Owner</th>
            <th className="px-2 text-left text-xs font-semibold text-muted-foreground">Score</th>
            <th className="px-2 text-left text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              <Button aria-label="Sort by last activity" variant="ghost" size="sm" className="h-8 max-w-full px-0 font-medium uppercase text-xs tracking-[0.08em]" onClick={p.onToggleActivitySort}>
                Activity <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.isLoading ? (
            [...Array(Math.max(1, p.skeletonRows))].map((_, i) => (
              <tr key={i} className="border-b">
                {p.isManagerOrAdmin && <td><Skeleton className="h-4 w-4" /></td>}
                {[0, 1, 2, 3, 4, 5].map((c) => (
                  <td key={c}><Skeleton className="h-4 w-4/5" /></td>
                ))}
              </tr>
            ))
          ) : p.unavailable ? (
            <tr><td colSpan={cols} className="text-center text-muted-foreground" style={{ height: 120 }}>Lead results are unavailable.</td></tr>
          ) : showEmpty ? (
            <tr><td colSpan={cols} style={{ height: "auto", padding: 0 }}>{empty}</td></tr>
          ) : (
            p.leads?.map((lead) => {
              const score = lead.leadScore;
              return (
                <tr key={lead.id} data-leads-row
                  className={cn("border-b cursor-pointer transition-colors hover:bg-muted", p.selectedIds.has(lead.id) && "bg-info-bg/40")}
                  onClick={event => {
                    // Links, selection, contact actions and assignee pickers own
                    // their clicks; only otherwise inactive row space navigates.
                    if ((event.target as HTMLElement).closest("a, button, input, select, textarea, [role=checkbox], [role=combobox], [role=button]")) return;
                    if (window.getSelection()?.toString()) return;
                    navigate(detail(lead.id));
                  }}>
                  {p.isManagerOrAdmin && (
                    <td>
                      <Checkbox checked={p.selectedIds.has(lead.id)} onCheckedChange={() => p.onToggleSelect(lead.id)} aria-label={`Select lead ${lead.id}`} />
                    </td>
                  )}
                  <td>
                    <Link href={detail(lead.id)} className="leads-fit-line font-medium text-foreground hover:underline" title={formatLeadIdentity(lead)}>
                      {formatLeadIdentity(lead)}
                    </Link>
                    <div className="flex min-w-0 items-center gap-1">
                      <Link href={detail(lead.id)} className="leads-fit-line min-w-0 flex-1 text-xs text-success hover:underline" title={lead.companyName || undefined}>
                        {lead.companyName || "No company"}
                      </Link>
                      <button type="button" className="leads-fit-details shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`View details for ${formatLeadIdentity(lead)}`} onClick={() => setExpandedLead(lead)}>
                        <Info size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  <td>
                    {lead.phone?.trim()
                      ? <PhoneLink phone={lead.phone} leadId={lead.id} className="text-xs" />
                      : <span className="leads-fit-line text-xs text-muted-foreground">Phone unavailable</span>}
                    {lead.email?.trim()
                      ? <EmailLink email={lead.email} leadId={lead.id} className="text-xs" />
                      : <span className="leads-fit-line text-xs text-muted-foreground">Email unavailable</span>}
                  </td>
                  <td>
                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                      <Badge variant="secondary" title={formatStatus(lead.status)} className="min-w-0 max-w-full font-normal whitespace-nowrap"><span className="truncate">{formatStatus(lead.status)}</span></Badge>
                      {lead.isStale && <Badge className="bg-danger-bg text-danger hover:bg-danger-bg whitespace-nowrap">{lead.daysIdle}d idle</Badge>}
                    </div>
                    <Link href={detail(lead.id)} className="leads-fit-line text-xs capitalize text-muted-foreground" title={lead.needsAssignment ? "Inbound — needs assignment" : undefined}>
                      {lead.applicationType.replace(/_/g, " ")}
                      {lead.needsAssignment && <span className="text-warning"> · Inbound, needs assignment</span>}
                    </Link>
                  </td>
                  <td>
                    {p.isStaleView && p.isManagerOrAdmin ? (
                      <SearchableSelect
                        value={lead.assignedRepId ? String(lead.assignedRepId) : ""}
                        onValueChange={(repId) => p.onSingleAssign(lead.id, repId)}
                        disabled={p.assignPending}
                        placeholder="Assign rep…"
                        ariaLabel={`Assign representative for lead ${lead.id}`}
                        className="h-8 w-full text-xs"
                        options={(p.users ?? []).map((rep) => ({
                          value: String(rep.id),
                          label: getUserDisplayName(rep),
                          detail: rep.email || undefined,
                          keywords: [rep.email, rep.name].filter(Boolean).join(" "),
                        }))}
                      />
                    ) : (
                      <Link href={detail(lead.id)} className="leads-fit-line font-semibold text-foreground">
                        <span className="sr-only">Assigned Rep: </span>
                        {lead.assignedRep ? getUserDisplayName(lead.assignedRep) : <span className="italic text-warning">Unassigned</span>}
                      </Link>
                    )}
                    <Link href={detail(lead.id)} className="leads-fit-line text-xs text-muted-foreground" title={`Created by ${createdByLabel(lead)}`}>
                      Created by {createdByLabel(lead)}
                    </Link>
                  </td>
                  <td>
                    <Link href={detail(lead.id)} className="block">
                      {score !== null && score !== undefined ? (
                        <span className={cn(
                          "inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-full text-xs font-semibold",
                          score >= 70 ? "bg-success-bg text-success" : score >= 40 ? "bg-warning-bg text-warning" : "bg-danger-bg text-danger",
                        )}>{score}</span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </Link>
                  </td>
                  <td>
                    <Link href={detail(lead.id)} className="block text-muted-foreground">
                      <span className="leads-fit-line text-xs" title={lead.lastActivityAt ? `${formatDistanceToNow(new Date(lead.lastActivityAt), { addSuffix: true })} by ${getUserDisplayName(lead.lastActivityActor, "System")}` : undefined}>
                        {lead.lastActivityAt
                          ? `${formatDistanceToNow(new Date(lead.lastActivityAt), { addSuffix: true })} · ${getUserDisplayName(lead.lastActivityActor, "System")}`
                          : "No activity"}
                      </span>
                      <span className="leads-fit-line text-xs">Updated {format(new Date(lead.updatedAt), "MMM d, yyyy")}</span>
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <Dialog open={!!expandedLead} onOpenChange={(open) => { if (!open) setExpandedLead(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-xl" data-testid="dialog-lead-summary">
          <DialogHeader>
            <DialogTitle>Lead details</DialogTitle>
            <DialogDescription>Full values for the selected lead. Contact actions remain available here.</DialogDescription>
          </DialogHeader>
          {expandedLead && <dl className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm [&>dt]:text-muted-foreground [&>dd]:min-w-0 [&>dd]:[overflow-wrap:anywhere]">
            <dt>Company</dt><dd>{expandedLead.companyName || "No company"}</dd>
            <dt>Contact</dt><dd>{expandedLead.firstName} {expandedLead.lastName}</dd>
            <dt>Phone</dt><dd>{expandedLead.phone ? <PhoneLink phone={expandedLead.phone} leadId={expandedLead.id} /> : "Unavailable"}</dd>
            <dt>Email</dt><dd>{expandedLead.email ? <EmailLink email={expandedLead.email} leadId={expandedLead.id} className="max-w-full whitespace-normal [&>span]:break-all" /> : "Unavailable"}</dd>
            <dt>Status</dt><dd>{formatStatus(expandedLead.status)}</dd>
            <dt>Stale</dt><dd>{expandedLead.isStale ? `${expandedLead.daysIdle} days idle` : "No"}</dd>
            <dt>Type</dt><dd>{formatStatus(expandedLead.applicationType)}</dd>
            <dt>Created by</dt><dd>{createdByLabel(expandedLead)}</dd>
            <dt>Assigned rep</dt><dd>{getUserDisplayName(expandedLead.assignedRep, "Unassigned")}</dd>
            <dt>Score</dt><dd>{expandedLead.leadScore ?? "Not scored"}</dd>
            <dt>Activity</dt><dd>{expandedLead.lastActivityAt ? `${format(new Date(expandedLead.lastActivityAt), "MMM d, yyyy h:mm a")} · ${getUserDisplayName(expandedLead.lastActivityActor, "System")}` : "No activity"}</dd>
            <dt>Updated</dt><dd>{format(new Date(expandedLead.updatedAt), "MMM d, yyyy h:mm a")}</dd>
            {expandedLead.needsAssignment && <><dt>Assignment</dt><dd>Inbound — needs assignment</dd></>}
          </dl>}
        </DialogContent>
      </Dialog>
    </>
  );
}
