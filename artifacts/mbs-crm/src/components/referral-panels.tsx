import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Pencil } from "lucide-react";
import {
  useGetLeadReferrals, useGetPartnerReferrals, useUpdateLeadReferrer, useUpdateDealReferrer,
  useCreateLeadReferralLink, useCreatePartnerReferralLink, useGetLeadCampaignEngagement, useGetLeadCampaignReplies, getGetLeadCampaignRepliesQueryKey,
  getGetLeadReferralsQueryKey, getGetLeadQueryKey, getGetDealQueryKey, getGetLeadCampaignEngagementQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignRepliesList } from "@/components/campaign-replies-panel";
import { ReferrerSelect } from "@/components/referrer-select";
import { referrerPayload, referralFromIds, formatTracked, formatMoney } from "@/lib/campaignMetrics";

export function ReferredByEditor({ kind, recordId, leadId, partnerId, label }: { kind: "lead" | "deal"; recordId: number; leadId?: number | null; partnerId?: number | null; label?: string | null }) {
  const qc = useQueryClient();
  const updLead = useUpdateLeadReferrer();
  const updDeal = useUpdateDealReferrer();
  const [editing, setEditing] = useState(false);
  const current = referralFromIds(leadId, partnerId);
  const save = (next: { type: "lead" | "partner"; id: number } | null) => {
    const data = referrerPayload(next);
    const opts = {
      onSuccess: () => {
        toast.success(next ? "Referred by updated" : "Referred by cleared");
        setEditing(false);
        qc.invalidateQueries({ queryKey: kind === "lead" ? getGetLeadQueryKey(recordId) : getGetDealQueryKey(recordId) });
      },
      onError: (e: any) => toast.error(e?.data?.error || "Could not update referred by"),
    };
    if (kind === "lead") updLead.mutate({ id: recordId, data }, opts); else updDeal.mutate({ id: recordId, data }, opts);
  };
  const busy = updLead.isPending || updDeal.isPending;
  return (
    <div className="space-y-2" data-testid="referred-by-editor">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Referred by</div>
      {editing || !current ? (
        <div className="space-y-2">
          <ReferrerSelect value={null} excludeLeadId={kind === "lead" ? recordId : undefined} disabled={busy} onChange={(o) => o && save(o)} />
          {editing && <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ReferrerSelect value={{ ...current, label: label ?? undefined }} disabled={busy} onChange={() => save(null)} />
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-edit-referrer"><Pencil className="mr-1.5 h-3.5 w-3.5" />Change</Button>
        </div>
      )}
    </div>
  );
}

export function ReferredRecordsList({ type, id }: { type: "lead" | "partner"; id: number }) {
  const leadQ = useGetLeadReferrals(id, { query: { enabled: type === "lead", queryKey: getGetLeadReferralsQueryKey(id) } });
  const partnerQ = useGetPartnerReferrals(id, { query: { enabled: type === "partner", queryKey: ["partner-referrals", id] } as any });
  const q = type === "lead" ? leadQ : partnerQ;
  const linkLead = useCreateLeadReferralLink();
  const linkPartner = useCreatePartnerReferralLink();
  const share = () => {
    const m = type === "lead" ? linkLead : linkPartner;
    m.mutate({ id }, {
      onSuccess: async ({ token }) => {
        const url = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/apply?referral=${encodeURIComponent(token)}`;
        try { await navigator.clipboard.writeText(url); toast.success("Referral link copied"); } catch { toast.info(url); }
      },
      onError: () => toast.error("Couldn't create referral link"),
    });
  };
  const leads = q.data?.leads ?? [];
  const deals = q.data?.deals ?? [];
  return (
    <Card data-testid="panel-referred-records">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">Referred records</CardTitle>
        <Button size="sm" variant="outline" onClick={share} data-testid="button-share-referral-link"><Link2 className="mr-1.5 h-3.5 w-3.5" />Share referral link</Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.isLoading && <div className="h-16 animate-pulse rounded bg-muted" aria-busy="true" />}
        {q.isError && <div role="alert" className="text-danger">Couldn't load referrals. <button className="underline" onClick={() => q.refetch()}>Retry</button></div>}
        {q.data && leads.length === 0 && deals.length === 0 && <p className="text-muted-foreground">No referred leads or deals yet.</p>}
        {leads.length > 0 && (
          <ul className="divide-y rounded-md border">
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.firstName} {l.lastName}{l.companyName ? ` · ${l.companyName}` : ""}</Link>
                <span className="text-xs capitalize text-muted-foreground">{l.status.replace(/_/g, " ")} · {l.referredAt ? new Date(l.referredAt).toLocaleDateString() : "Referral date not tracked"}</span>
              </li>
            ))}
          </ul>
        )}
        {deals.length > 0 && (
          <ul className="divide-y rounded-md border">
            {deals.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <Link href={`/deals/${d.id}`} className="font-medium hover:underline">Deal #{d.id}</Link>
                <span className="text-xs capitalize text-muted-foreground">{d.stage.replace(/_/g, " ")} · {d.amount != null ? formatMoney(d.amount) : "—"}{d.actualGm != null ? ` · GM ${formatMoney(d.actualGm)}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function LeadCampaignEngagement({ leadId }: { leadId: number }) {
  const q = useGetLeadCampaignEngagement(leadId, { query: { queryKey: getGetLeadCampaignEngagementQueryKey(leadId) } });
  return (
    <Card data-testid="panel-campaign-engagement">
      <CardHeader className="pb-3"><CardTitle className="text-sm">Campaign engagement</CardTitle></CardHeader>
      <CardContent className="text-sm">
        {q.isLoading && <div className="h-12 animate-pulse rounded bg-muted" aria-busy="true" />}
        {q.isError && <div role="alert" className="text-danger">Couldn't load engagement. <button className="underline" onClick={() => q.refetch()}>Retry</button></div>}
        {q.data && q.data.length === 0 && <p className="text-muted-foreground">This lead hasn't been part of a campaign.</p>}
        {q.data && q.data.length > 0 && (
          <ul className="divide-y">
            {q.data.map((m) => (
              <li key={m.campaignId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/campaigns/${m.campaignId}`} className="font-medium hover:underline">{m.name}</Link>
                <span className="text-xs text-muted-foreground">
                  Clicks {formatTracked(m.totalFlyerClicks)}{m.firstClickAt ? ` · first ${new Date(m.firstClickAt).toLocaleString()}` : ""} · Replies {formatTracked(m.replies)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function LeadCampaignReplies({ leadId }: { leadId: number }) {
  const q = useGetLeadCampaignReplies(leadId, { query: { queryKey: getGetLeadCampaignRepliesQueryKey(leadId) } });
  return (
    <Card data-testid="panel-campaign-replies">
      <CardHeader className="pb-3"><CardTitle className="text-sm">Campaign replies</CardTitle></CardHeader>
      <CardContent><CampaignRepliesList replies={q.data} isLoading={q.isLoading} isError={q.isError} onRetry={() => void q.refetch()} /></CardContent>
    </Card>
  );
}
