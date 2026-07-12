import { useState, useMemo } from "react";
import {
  useGetMe, getGetMeQueryKey,
  useGetMyTasks, getGetMyTasksQueryKey,
  useGetAnalyticsSummary,
  useGetAnalyticsPipeline,
  useGetAnalyticsReps, getGetAnalyticsRepsQueryKey,
  useGetAnalyticsSources,
  useGetAnalyticsCommunications,
  useGetAnalyticsRenewals, getGetAnalyticsRenewalsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, Cell,
} from "recharts";
import {
  Users, CheckCircle2, Clock, TrendingUp, DollarSign, Activity,
  Download, X, ArrowUpDown, ArrowUp, ArrowDown, Calendar, RefreshCw, Plus,
} from "lucide-react";
import { Link } from "wouter";
import { format, startOfMonth, endOfMonth, subMonths, startOfQuarter, startOfYear } from "date-fns";

const BRAND = "#1F4E79";
const TEAL = "#0D9488";

type DateRangePreset = "this_month" | "last_month" | "this_quarter" | "ytd" | "custom";

interface DateRange {
  startDate: string;
  endDate: string;
}

function getPresetRange(preset: DateRangePreset, custom?: DateRange): DateRange {
  const now = new Date();
  const fmt = (d: Date) => format(d, "yyyy-MM-dd");
  switch (preset) {
    case "this_month":
      return { startDate: fmt(startOfMonth(now)), endDate: fmt(now) };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { startDate: fmt(startOfMonth(lm)), endDate: fmt(endOfMonth(lm)) };
    }
    case "this_quarter":
      return { startDate: fmt(startOfQuarter(now)), endDate: fmt(now) };
    case "ytd":
      return { startDate: fmt(startOfYear(now)), endDate: fmt(now) };
    case "custom":
      return custom ?? { startDate: fmt(startOfMonth(now)), endDate: fmt(now) };
  }
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers.map((h) => {
        const v = r[h];
        return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "");
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatStage(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STAGE_COLORS: Record<string, string> = {
  new_lead: "#3B82F6",
  contacted: "#6366F1",
  application_received: "#F59E0B",
  submitted_to_underwriting: "#8B5CF6",
  approved: "#10B981",
  funded: "#059669",
};

type SortField = "leadsCount" | "callsMade" | "smsSent" | "emailsSent" | "applications" | "approvals" | "fundings" | "revenue";

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${value.toLocaleString()}`;
}

type SortDir = "asc" | "desc";

function KpiCard({
  label,
  value,
  icon,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-sm border-slate-100">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          {label}
        </CardTitle>
        <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="text-3xl font-bold tabular-nums text-slate-900">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [preset, setPreset] = useState<DateRangePreset>("this_month");
  const [customRange, setCustomRange] = useState<DateRange>({
    startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
  });
  const [selectedRepId, setSelectedRepId] = useState<number | undefined>();
  const [sortField, setSortField] = useState<SortField>("leadsCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: currentUser, isLoading: loadingUser } = useGetMe({
    query: { queryKey: getGetMeQueryKey() },
  });
  const { data: myTasks } = useGetMyTasks({
    query: { queryKey: getGetMyTasksQueryKey() },
  });

  const isRep = currentUser?.role === "rep";
  const effectiveRepId = isRep ? currentUser?.id : selectedRepId;

  const dateRange = getPresetRange(preset, customRange);
  const queryParams = {
    start_date: dateRange.startDate,
    end_date: dateRange.endDate,
    ...(effectiveRepId != null ? { rep_id: effectiveRepId } : {}),
  };

  const { data: summary, isLoading: loadingSummary } = useGetAnalyticsSummary(queryParams);
  const { data: pipeline, isLoading: loadingPipeline } = useGetAnalyticsPipeline(queryParams);
  const { data: sources, isLoading: loadingSources } = useGetAnalyticsSources(queryParams);
  const { data: communications, isLoading: loadingComms } = useGetAnalyticsCommunications({
    ...queryParams,
    granularity: "daily",
  });
  const repsParams = { start_date: dateRange.startDate, end_date: dateRange.endDate };
  const { data: reps, isLoading: loadingReps } = useGetAnalyticsReps(repsParams, {
    query: { queryKey: getGetAnalyticsRepsQueryKey(repsParams), enabled: !loadingUser && !isRep },
  });
  const renewalsParams = effectiveRepId != null ? { rep_id: effectiveRepId } : {};
  const { data: renewals, isLoading: loadingRenewals } = useGetAnalyticsRenewals(renewalsParams, {
    query: { queryKey: getGetAnalyticsRenewalsQueryKey(renewalsParams), enabled: !loadingUser },
  });

  const sortedReps = useMemo(() => {
    if (!reps) return [];
    return [...reps].sort((a, b) => {
      const av = ((a as unknown) as Record<string, number>)[sortField] ?? 0;
      const bv = ((b as unknown) as Record<string, number>)[sortField] ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [reps, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 opacity-40 ml-1 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1 inline text-[#1F4E79]" />
      : <ArrowDown className="h-3 w-3 ml-1 inline text-[#1F4E79]" />;
  };

  const presets: { id: DateRangePreset; label: string }[] = [
    { id: "this_month", label: "This Month" },
    { id: "last_month", label: "Last Month" },
    { id: "this_quarter", label: "This Quarter" },
    { id: "ytd", label: "YTD" },
    { id: "custom", label: "Custom" },
  ];

  const anyLoading = loadingUser || loadingSummary || loadingPipeline || loadingSources || loadingComms;
  const selectedRepName = reps?.find((r) => r.repId === selectedRepId)?.repName;

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isRep ? "Your performance metrics" : "Team pipeline analytics"}
          </p>
        </div>
        {!isRep && selectedRepId != null && (
          <Button variant="outline" size="sm" onClick={() => setSelectedRepId(undefined)}>
            <X className="h-4 w-4 mr-1" />
            Clear Rep Filter
          </Button>
        )}
      </div>

      {/* Date Range Selector */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {presets.map((p) => (
          <Button
            key={p.id}
            variant={preset === p.id ? "default" : "outline"}
            size="sm"
            className={preset === p.id ? "bg-[#1F4E79] hover:bg-[#1F4E79]/90" : ""}
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </Button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={customRange.startDate}
              onChange={(e) => setCustomRange((r) => ({ ...r, startDate: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">to</span>
            <Input
              type="date"
              className="h-8 w-36 text-sm"
              value={customRange.endDate}
              onChange={(e) => setCustomRange((r) => ({ ...r, endDate: e.target.value }))}
            />
          </div>
        )}
        {anyLoading && (
          <span className="text-xs text-muted-foreground animate-pulse ml-2">Refreshing…</span>
        )}
        {!isRep && selectedRepName && (
          <Badge variant="secondary" className="ml-2">
            Filtered: {selectedRepName}
          </Badge>
        )}
      </div>

      {/* First-run call-to-action */}
      {!loadingSummary && summary && (summary as any).totalLeads === 0 && (
        <div className="bg-[#1F4E79]/5 border border-[#1F4E79]/20 rounded-xl p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-[#1F4E79]/10 flex items-center justify-center flex-shrink-0">
            <Users className="h-5 w-5 text-[#1F4E79]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900">Welcome to MBS CRM!</p>
            <p className="text-sm text-muted-foreground mt-0.5">Add your first lead or import a list to start tracking your pipeline.</p>
          </div>
          <div className="flex gap-2 flex-wrap flex-shrink-0">
            <Link href="/leads/new">
              <button className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1F4E79] px-4 text-sm font-medium text-white shadow hover:bg-[#163a5f] transition-colors">
                <Plus className="h-4 w-4" />
                Add First Lead
              </button>
            </Link>
            <Link href="/leads">
              <button className="inline-flex h-9 items-center rounded-md border border-input bg-white px-4 text-sm font-medium hover:bg-accent transition-colors">
                View Leads
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* KPI Cards — 2 rows of 3 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-6">
        <KpiCard
          label="Leads Generated"
          value={summary?.totalLeads ?? 0}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Applications Received"
          value={summary?.totalApplications ?? 0}
          icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Approvals"
          value={summary?.totalApprovals ?? 0}
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Fundings"
          value={summary?.totalFundings ?? 0}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Revenue Generated"
          value={formatCurrency(summary?.totalRevenue ?? 0)}
          icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Conversion Rate"
          value={`${summary?.conversionRate ?? 0}%`}
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
        <KpiCard
          label="Avg Funding Time"
          value={summary?.avgFundingTimeDays != null ? `${summary.avgFundingTimeDays}d` : "—"}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          loading={loadingSummary}
        />
      </div>

      {/* Pipeline Funnel */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Pipeline Funnel</CardTitle>
            <CardDescription>Lead count and drop-off at each funnel stage</CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const rows = (pipeline?.stages ?? []).map((s) => ({
                Stage: formatStage(s.status),
                Count: s.count,
                "Conversion from Previous (%)": s.conversionFromPrevious ?? "",
              }));
              downloadCsv(rows, `pipeline_${dateRange.startDate}_${dateRange.endDate}.csv`);
            }}
          >
            <Download className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {loadingPipeline ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart
                data={pipeline?.stages ?? []}
                layout="vertical"
                margin={{ top: 0, right: 100, left: 170, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="status"
                  tick={{ fontSize: 11 }}
                  tickFormatter={formatStage}
                  width={165}
                />
                <Tooltip
                  formatter={(_v, _n, props) => {
                    const conv = props.payload?.conversionFromPrevious;
                    return [
                      `${props.payload?.count} leads${conv != null ? ` · ${conv}% from prev` : ""}`,
                      "Count",
                    ];
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: "right", fontSize: 11 }}>
                  {(pipeline?.stages ?? []).map((entry) => (
                    <Cell key={entry.status} fill={STAGE_COLORS[entry.status] ?? BRAND} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Renewal Opportunities */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                Renewal Opportunities
                <Badge className="bg-[#1F4E79] hover:bg-[#1F4E79]">
                  {loadingRenewals ? "…" : (renewals?.length ?? 0)}
                </Badge>
              </CardTitle>
              <CardDescription>Funded deals far enough into their term to re-fund</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingRenewals ? (
            <Skeleton className="h-24 w-full" />
          ) : !(renewals ?? []).length ? (
            <div className="h-24 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1">
              <RefreshCw className="h-5 w-5 opacity-40" />
              No renewal opportunities right now.
            </div>
          ) : (
            <div className="divide-y">
              {(renewals ?? []).map((r) => {
                const name = [r.firstName, r.lastName].filter(Boolean).join(" ") || r.companyName || "Unnamed lead";
                return (
                  <Link
                    key={r.id}
                    href={`/leads/${r.id}`}
                    className="flex items-center justify-between py-3 hover:bg-muted/40 transition-colors -mx-2 px-2 rounded"
                  >
                    <div>
                      <p className="font-medium text-[#1F4E79]">{name}</p>
                      {r.companyName && r.firstName && (
                        <p className="text-xs text-muted-foreground">{r.companyName}</p>
                      )}
                    </div>
                    <div className="text-right text-sm">
                      <p className="text-muted-foreground">
                        Funded {r.fundedAt ? format(new Date(r.fundedAt), "MMM d, yyyy") : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.assignedRepName ?? "Unassigned"}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Lead Source Chart */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Lead Sources</CardTitle>
              <CardDescription>Volume by source with funded overlay</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const rows = (sources ?? []).map((s) => ({
                  Source: s.source,
                  "Lead Count": s.leadCount,
                  "Funded Count": s.fundedCount,
                  "Conversion Rate (%)": s.conversionRate,
                }));
                downloadCsv(rows, `lead-sources_${dateRange.startDate}_${dateRange.endDate}.csv`);
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingSources ? (
              <Skeleton className="h-52 w-full" />
            ) : !(sources ?? []).length ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                No source data for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={(sources ?? []).map((s) => ({
                    ...s,
                    sourceLabel: s.source.charAt(0).toUpperCase() + s.source.slice(1),
                  }))}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="sourceLabel" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(v, name) => [
                      v,
                      name === "leadCount" ? "Total Leads" : "Funded",
                    ]}
                  />
                  <Legend formatter={(v) => (v === "leadCount" ? "Total Leads" : "Funded")} />
                  <Bar dataKey="leadCount" name="leadCount" fill={BRAND} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="fundedCount" name="fundedCount" fill={TEAL} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Communications Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Communication Activity</CardTitle>
              <CardDescription>Daily call and SMS volume</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const rows = (communications ?? []).map((c) => ({
                  Date: c.date,
                  Calls: c.calls,
                  SMS: c.sms,
                }));
                downloadCsv(rows, `communications_${dateRange.startDate}_${dateRange.endDate}.csv`);
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingComms ? (
              <Skeleton className="h-52 w-full" />
            ) : !(communications ?? []).length ? (
              <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                No communication data for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={communications}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d) => {
                      try { return format(new Date(d + "T00:00:00"), "MMM d"); } catch { return d; }
                    }}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(d) => {
                      try { return format(new Date(d + "T00:00:00"), "MMM d, yyyy"); } catch { return d; }
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="calls"
                    name="Calls"
                    stroke={BRAND}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="sms"
                    name="SMS"
                    stroke={TEAL}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rep Performance Table — managers/admins only */}
      {!isRep && (
        <Card className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Rep Performance</CardTitle>
              <CardDescription>
                Click a rep name to filter the entire dashboard · click column headers to sort
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!reps) return;
                const rows = reps.map((r) => ({
                  Rep: r.repName,
                  Leads: r.leadsCount,
                  Calls: r.callsMade,
                  SMS: r.smsSent,
                  Emails: r.emailsSent,
                  Applications: r.applications,
                  Approvals: r.approvals,
                  Fundings: r.fundings,
                  Revenue: r.revenue,
                }));
                downloadCsv(rows, `rep-performance_${dateRange.startDate}_${dateRange.endDate}.csv`);
              }}
            >
              <Download className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingReps ? (
              <Skeleton className="h-40 w-full" />
            ) : !sortedReps.length ? (
              <p className="text-sm text-muted-foreground text-center py-6">No rep data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Rep</th>
                      {(
                        [
                          ["leadsCount", "Leads"],
                          ["callsMade", "Calls"],
                          ["smsSent", "SMS"],
                          ["emailsSent", "Emails"],
                          ["applications", "Applications"],
                          ["approvals", "Approvals"],
                          ["fundings", "Fundings"],
                          ["revenue", "Revenue"],
                        ] as [SortField, string][]
                      ).map(([field, label]) => (
                        <th
                          key={field}
                          className="text-right py-2 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                          onClick={() => handleSort(field)}
                        >
                          {label}
                          <SortIcon field={field} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedReps.map((rep) => (
                      <tr
                        key={rep.repId}
                        className={`border-b last:border-0 hover:bg-muted/40 transition-colors ${
                          selectedRepId === rep.repId ? "bg-blue-50" : ""
                        }`}
                      >
                        <td className="py-2 pr-4">
                          <button
                            className="text-[#1F4E79] font-medium hover:underline text-left"
                            onClick={() =>
                              setSelectedRepId(selectedRepId === rep.repId ? undefined : rep.repId)
                            }
                          >
                            {rep.repName}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.leadsCount}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.callsMade}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.smsSent}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.emailsSent}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.applications}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{rep.approvals}</td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-emerald-700">
                          {rep.fundings}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-semibold text-[#1F4E79]">
                          {formatCurrency(rep.revenue ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tasks panel */}
      <Card>
        <CardHeader>
          <CardTitle>My Tasks</CardTitle>
          <CardDescription>Quick view of your task queue</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-lg border bg-destructive/5 border-destructive/20 p-4">
              <p className="text-xs font-medium text-destructive uppercase tracking-wide mb-1">Overdue</p>
              <p className="text-3xl font-bold text-destructive">{myTasks?.overdue?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Due Today</p>
              <p className="text-3xl font-bold">{myTasks?.dueToday?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Due This Week</p>
              <p className="text-3xl font-bold">{myTasks?.dueThisWeek?.length ?? 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
