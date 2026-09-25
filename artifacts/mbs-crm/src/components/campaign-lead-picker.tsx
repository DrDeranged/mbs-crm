import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, UserRoundPlus } from "lucide-react";
import {
  addCampaignLeadIds,
  assertCampaignLeadResultCap,
  CAMPAIGN_LEAD_PICKER_PAGE_SIZE,
  MAX_CAMPAIGN_PICKED_LEADS,
  resolveCampaignLeads,
  searchCampaignLeads,
  type CampaignPickerLead,
} from "@/lib/campaignLeadPicker";

type Props = {
  selectedIds: number[];
  onChange: (ids: number[]) => void;
};

function leadName(lead: CampaignPickerLead) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || `Lead #${lead.id}`;
}

export function CampaignLeadPicker({ selectedIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [leads, setLeads] = useState<CampaignPickerLead[]>([]);
  const [metadata, setMetadata] = useState<Record<number, CampaignPickerLead>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [error, setError] = useState("");
  const selectedKey = useMemo(() => [...selectedIds].sort((a, b) => a - b).join(","), [selectedIds]);

  useEffect(() => {
    let cancelled = false;
    const ids = selectedKey ? selectedKey.split(",").map(Number) : [];
    if (!ids.length) return;
    resolveCampaignLeads(ids).then((resolved) => {
      if (!cancelled) {
        setMetadata((previous) => ({ ...previous, ...Object.fromEntries(resolved.map((lead) => [lead.id, lead])) }));
        setError("");
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? `Could not load picked lead details: ${reason.message}` : "Could not load picked lead details.");
    });
    return () => { cancelled = true; };
  }, [selectedKey]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      searchCampaignLeads(search.trim(), page, CAMPAIGN_LEAD_PICKER_PAGE_SIZE).then((result) => {
        if (!cancelled) {
          setLeads(result.leads);
          setTotal(result.total);
        }
      }).catch((reason: unknown) => {
        if (!cancelled) {
          setLeads([]);
          setTotal(0);
          setError(reason instanceof Error ? reason.message : "Could not search leads.");
        }
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, search, page]);

  const setPicked = (id: number, checked: boolean) => {
    try {
      const next = checked ? addCampaignLeadIds(selectedIds, [id]) : selectedIds.filter((pickedId) => pickedId !== id);
      onChange(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update manually picked leads.");
    }
  };

  const selectAllResults = async () => {
    setSelectingAll(true);
    setError("");
    try {
      const result = await searchCampaignLeads(search.trim(), 1, MAX_CAMPAIGN_PICKED_LEADS);
      assertCampaignLeadResultCap(result.total);
      if (result.leads.length < result.total) {
        throw new Error("The search did not return every matching lead. Refine your search and try again.");
      }
      const next = addCampaignLeadIds(selectedIds, result.leads.map((lead) => lead.id));
      setMetadata((previous) => ({ ...previous, ...Object.fromEntries(result.leads.map((lead) => [lead.id, lead])) }));
      onChange(next);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not select all search results.");
    } finally {
      setSelectingAll(false);
    }
  };

  return (
    <div className="md:col-span-2 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Manually picked leads <span className="text-slate-500">({selectedIds.length})</span></p>
          <p className="text-sm text-slate-500">Picked leads are added independently of the audience filters.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button type="button" variant="outline" onClick={() => { setError(""); setOpen(true); }}>
            <UserRoundPlus className="mr-2 h-4 w-4" /> Add leads
          </Button>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Add leads to this campaign</DialogTitle>
              <DialogDescription>Search by name, company, email, or lead source. You can select up to {MAX_CAMPAIGN_PICKED_LEADS.toLocaleString()} leads.</DialogDescription>
            </DialogHeader>
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, company, email, or source…" aria-label="Search leads" />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-500">{loading ? "Searching…" : `${total.toLocaleString()} matching leads`}</span>
              <Button type="button" variant="secondary" size="sm" onClick={selectAllResults} disabled={loading || selectingAll || total === 0}>
                {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString()} results`}
              </Button>
            </div>
            {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <div className="max-h-[45vh] min-h-40 overflow-auto rounded-md border">
              {leads.map((lead) => (
                <label key={lead.id} className="flex cursor-pointer items-start gap-3 border-b p-3 last:border-0 hover:bg-slate-50">
                  <Checkbox checked={selectedIds.includes(lead.id)} onCheckedChange={(checked) => setPicked(lead.id, Boolean(checked))} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{leadName(lead)}</span>
                    <span className="block truncate text-sm text-slate-500">{[lead.companyName, lead.email, lead.leadSource].filter(Boolean).join(" · ") || "No company, email, or source metadata"}</span>
                  </span>
                </label>
              ))}
              {!loading && leads.length === 0 && !error && <p className="p-6 text-center text-sm text-slate-500">No leads match this search.</p>}
            </div>
            <DialogFooter className="flex-row items-center justify-between sm:justify-between">
              <span className="text-sm text-slate-500">Page {page} of {Math.max(1, Math.ceil(total / CAMPAIGN_LEAD_PICKER_PAGE_SIZE))}</span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || loading}>Previous</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={loading || page * CAMPAIGN_LEAD_PICKER_PAGE_SIZE >= total}>Next</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {error && !open && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {selectedIds.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {selectedIds.map((id) => {
            const lead = metadata[id];
            return (
              <Badge key={id} variant="secondary" className="max-w-full gap-1 py-1">
                <span className="truncate" title={lead ? [lead.companyName, lead.email, lead.leadSource].filter(Boolean).join(" · ") : `Lead #${id}`}>
                  {lead ? `${leadName(lead)}${lead.companyName ? ` · ${lead.companyName}` : ""}${lead.email ? ` · ${lead.email}` : ""}${lead.leadSource ? ` · ${lead.leadSource}` : ""}` : `Lead #${id} · loading details`}
                </span>
                <button type="button" onClick={() => onChange(selectedIds.filter((pickedId) => pickedId !== id))} aria-label={`Remove ${lead ? leadName(lead) : `lead ${id}`}`}><X className="h-3 w-3" /></button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}