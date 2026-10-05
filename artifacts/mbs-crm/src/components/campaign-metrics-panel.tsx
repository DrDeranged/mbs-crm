import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import type { CampaignMetrics } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { DEFAULT_DEFINITIONS, METRIC_ROWS } from "@/lib/campaignMetrics";

export function MetricsDefinitions({ metrics }: { metrics?: CampaignMetrics[] }) {
  const defs = Array.from(new Set([...DEFAULT_DEFINITIONS, ...(metrics ?? []).flatMap((m) => m.definitions ?? [])]));
  return (
    <details className="rounded-lg border bg-card p-3 text-sm" data-testid="metrics-definitions">
      <summary className="flex cursor-pointer items-center gap-2 font-medium"><Info className="h-4 w-4 text-info" /> How these numbers are defined</summary>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-muted-foreground">{defs.map((d) => <li key={d}>{d}</li>)}</ul>
    </details>
  );
}

export function MetricsState({ isLoading, isError, onRetry, empty, children }: { isLoading: boolean; isError: boolean; onRetry: () => void; empty?: boolean; children: React.ReactNode }) {
  if (isLoading) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  if (isError) return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm text-danger">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Couldn't load campaign metrics.</span>
      <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry</Button>
    </div>
  );
  if (empty) return <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">No campaign metrics yet. Numbers appear after the first send.</div>;
  return <>{children}</>;
}

export function CampaignKpiPanel({ metrics }: { metrics: CampaignMetrics }) {
  return (
    <section aria-label="Campaign KPIs" data-testid="panel-campaign-kpis" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Performance</h3>
        <p className="text-xs text-muted-foreground">
          {metrics.trackingSince ? `Tracking since ${new Date(metrics.trackingSince).toLocaleDateString()}` : "Historical tracking not available"}
          {!metrics.replyCaptureConfigured && " · Reply capture not configured"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {METRIC_ROWS.map((row) => (
          <div key={row.key} className="rounded-lg border bg-card p-3" data-testid={`kpi-${row.key}`}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{row.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">{row.format(metrics)}</dd>
            {row.note && <p className="text-[11px] text-muted-foreground">{row.note}</p>}
          </div>
        ))}
      </dl>
      {!!metrics.engagedLeads?.length && (
        <details className="rounded-lg border bg-card p-3" data-testid="campaign-lead-drilldown">
          <summary className="cursor-pointer text-sm font-medium">Engaged leads ({metrics.engagedLeads.length})</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr><th className="p-2">Lead</th><th className="p-2">First flyer click</th><th className="p-2">Total clicks</th><th className="p-2">Replies</th><th className="p-2">Calls</th></tr></thead>
              <tbody>{metrics.engagedLeads.map(lead => (
                <tr key={lead.leadId} className="border-t">
                  <td className="p-2"><Link href={`/leads/${lead.leadId}`} className="font-medium text-primary underline underline-offset-2">{lead.label}</Link></td>
                  <td className="p-2">{lead.firstClickAt ? new Date(lead.firstClickAt).toLocaleString() : "—"}</td>
                  <td className="p-2 tabular-nums">{lead.totalFlyerClicks}</td><td className="p-2 tabular-nums">{lead.replies}</td><td className="p-2 tabular-nums">{lead.calls}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
      {metrics.unpricedFundedDeals > 0 && (
        <p className="text-xs text-warning">{metrics.unpricedFundedDeals} funded referred deal(s) have no verified pricing; MBS points exclude those deals.</p>
      )}
    </section>
  );
}

export function CampaignComparisonTable({ rows, onOpen }: { rows: CampaignMetrics[]; onOpen: (id: number) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card" data-testid="table-campaign-comparison">
      <table className="w-full min-w-max text-sm">
        <caption className="sr-only">Side-by-side campaign comparison</caption>
        <thead>
          <tr className="border-b bg-muted/60">
            <th scope="col" className="sticky left-0 z-10 bg-muted px-4 py-3 text-left font-medium text-muted-foreground">Metric</th>
            {rows.map((c) => (
              <th key={c.campaignId} scope="col" className="px-4 py-3 text-right font-semibold">
                <button type="button" className="max-w-[10rem] truncate text-right hover:underline" onClick={() => onOpen(c.campaignId)} data-testid={`link-compare-${c.campaignId}`}>{c.name}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              <th scope="row" className="sticky left-0 bg-card px-4 py-2 text-left font-normal text-muted-foreground">{row.label}</th>
              {rows.map((c) => <td key={c.campaignId} className="px-4 py-2 text-right tabular-nums">{row.format(c)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
