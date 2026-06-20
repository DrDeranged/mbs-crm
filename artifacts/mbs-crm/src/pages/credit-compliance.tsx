import { useState } from "react";
import { useGetMe, useGetCreditComplianceLog, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useLocation } from "wouter";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-muted-foreground text-sm">N/A</span>;
  const cls =
    score >= 740 ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
    score >= 670 ? "bg-green-100 text-green-800 border-green-200" :
    score >= 580 ? "bg-yellow-100 text-yellow-800 border-yellow-200" :
    "bg-red-100 text-red-800 border-red-200";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>{score}</span>;
}

export default function CreditCompliance() {
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [repId, setRepId] = useState<string>("all");

  const { data: users } = useListUsers({ role: "rep" });

  const { data, isLoading } = useGetCreditComplianceLog({
    page,
    limit: 25,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    repId: repId !== "all" ? Number(repId) : undefined,
  });

  if (me && me.role !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Admin Access Required</h2>
          <p className="text-muted-foreground text-sm">Only administrators can view the credit compliance log.</p>
        </div>
      </div>
    );
  }

  const handleExport = () => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (repId !== "all") params.set("repId", repId);
    window.open(`${apiBase}/credit/compliance-log/export?${params}`, "_blank");
  };

  const handleFilter = () => setPage(1);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[#1F4E79]" />
            Credit Compliance Log
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Read-only append-only audit trail of all Experian credit pulls</p>
        </div>
        <Button variant="outline" onClick={handleExport} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Rep</label>
              <Select value={repId} onValueChange={setRepId}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All Reps" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Reps</SelectItem>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleFilter} className="bg-[#1F4E79] hover:bg-[#163a5f]">Apply</Button>
            <Button variant="ghost" onClick={() => { setStartDate(""); setEndDate(""); setRepId("all"); setPage(1); }}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data?.data?.length ? (
            <div className="py-16 text-center">
              <ShieldCheck className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-muted-foreground">No credit pulls found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Date</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Lead</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Pulled By</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Pull Type</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Score</th>
                    <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Permissible Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((entry, i) => (
                    <tr key={entry.id} className={`border-b last:border-0 hover:bg-muted/20 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                      <td className="py-3 px-4 text-muted-foreground">
                        {format(new Date(entry.date!), "MMM d, yyyy HH:mm")}
                      </td>
                      <td className="py-3 px-4">
                        <a
                          href={`/leads/${entry.leadId}`}
                          className="font-medium text-[#1F4E79] hover:underline"
                          onClick={(e) => { e.preventDefault(); navigate(`/leads/${entry.leadId}`); }}
                        >
                          {entry.leadName}
                        </a>
                      </td>
                      <td className="py-3 px-4">{entry.pulledBy?.name ?? "—"}</td>
                      <td className="py-3 px-4">
                        {entry.pullType ? (
                          <Badge variant="outline" className={entry.pullType === "hard" ? "border-orange-300 text-orange-700" : "border-blue-300 text-blue-700"}>
                            {entry.pullType === "hard" ? "Hard" : "Soft"}
                          </Badge>
                        ) : "—"}
                      </td>
                      <td className="py-3 px-4">
                        <ScoreBadge score={entry.score as number | null} />
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs">{entry.permissiblePurpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && (data.pages ?? 0) > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * 25) + 1}–{Math.min(page * 25, data.total ?? 0)} of {data.total ?? 0} entries
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">{page} / {data.pages ?? 1}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(data.pages ?? p, p + 1))} disabled={page >= (data.pages ?? 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
