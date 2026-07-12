import { useState } from "react";
import { useGetMe, useListUsers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, Download, ChevronLeft, ChevronRight, Trash2, Eye, FileText, AlertTriangle, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type PiiLogEntry = {
  id: number;
  userId: number | null;
  leadId: number | null;
  fieldCategory: "ssn" | "credit" | "application";
  action: "view" | "export";
  ip: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
};

type LogPage = {
  data: PiiLogEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

type RetentionPreview = {
  retentionMonths: number;
  cutoffDate: string;
  eligibleCount: number;
  eligible: { id: number; name: string; email: string | null; status: string; lastUpdated: string }[];
};

function CategoryBadge({ category }: { category: string }) {
  const map: Record<string, string> = {
    ssn: "bg-red-100 text-red-800 border-red-200",
    credit: "bg-orange-100 text-orange-800 border-orange-200",
    application: "bg-blue-100 text-blue-800 border-blue-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${map[category] ?? "bg-gray-100 text-gray-800"}`}>
      {category}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${action === "export" ? "bg-purple-100 text-purple-800 border-purple-200" : "bg-gray-100 text-gray-700 border-gray-200"}`}>
      {action}
    </span>
  );
}

export default function Governance() {
  const { data: me } = useGetMe();
  const { toast } = useToast();
  const { data: users } = useListUsers({});

  // PII Access Log state
  const [logPage, setLogPage] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterUserId, setFilterUserId] = useState<string>("all");
  const [filterLeadId, setFilterLeadId] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [logData, setLogData] = useState<LogPage | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  // Retention / purge state
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [purging, setPurging] = useState(false);

  // Retention settings state
  const [retentionMonths, setRetentionMonths] = useState<string>("");
  const [savingRetention, setSavingRetention] = useState(false);

  const fetchLog = async (page = 1) => {
    setLogLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (filterUserId !== "all") params.set("userId", filterUserId);
      if (filterLeadId) params.set("leadId", filterLeadId);
      if (filterCategory !== "all") params.set("category", filterCategory);
      const res = await fetch(`${apiBase}/pii-access-log?${params}`, { credentials: "include" });
      if (res.ok) setLogData(await res.json());
    } finally {
      setLogLoading(false);
    }
  };

  const handleExportLog = () => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (filterUserId !== "all") params.set("userId", filterUserId);
    if (filterLeadId) params.set("leadId", filterLeadId);
    window.open(`${apiBase}/pii-access-log/export?${params}`, "_blank");
  };

  const handleFetchPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/data-governance/retention-preview`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPreview(data);
        setRetentionMonths(String(data.retentionMonths));
      } else {
        toast({ title: "Error", description: "Failed to load retention preview", variant: "destructive" });
      }
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePurge = async () => {
    if (!window.confirm(`This will permanently delete ${preview?.eligibleCount ?? 0} leads past the retention window. Are you sure?`)) return;
    setPurging(true);
    try {
      const res = await fetch(`${apiBase}/admin/data-governance/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Purge complete", description: data.message });
        setPreview(null);
      } else {
        toast({ title: "Purge failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } finally {
      setPurging(false);
    }
  };

  const handleSaveRetention = async () => {
    const months = parseInt(retentionMonths, 10);
    if (isNaN(months) || months < 1) {
      toast({ title: "Invalid value", description: "Retention must be a positive integer (months)", variant: "destructive" });
      return;
    }
    setSavingRetention(true);
    try {
      const res = await fetch(`${apiBase}/settings/company`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ retentionMonths: months }),
      });
      if (res.ok) {
        toast({ title: "Saved", description: `Retention policy set to ${months} months` });
      } else {
        toast({ title: "Save failed", variant: "destructive" });
      }
    } finally {
      setSavingRetention(false);
    }
  };

  if (me && me.role !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Admin Access Required</h2>
          <p className="text-muted-foreground text-sm">Only administrators can view the governance dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-[#1F4E79]" />
          Data Governance
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">PII access log, data retention policy, and Right to be Forgotten (RTBF) controls</p>
      </div>

      {/* PII Access Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> PII Access Log</CardTitle>
              <CardDescription>Every time a user views SSN, credit data, or full application detail</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportLog} className="gap-1.5">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End Date</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 text-sm w-36" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">User</label>
              <Select value={filterUserId} onValueChange={setFilterUserId}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {users?.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Category</label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="ssn">SSN</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="application">Application</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Lead ID</label>
              <Input placeholder="Lead ID" value={filterLeadId} onChange={(e) => setFilterLeadId(e.target.value)} className="h-8 text-sm w-24" />
            </div>
            <Button size="sm" onClick={() => { setLogPage(1); fetchLog(1); }} className="h-8">Search</Button>
            <Button size="sm" variant="ghost" onClick={() => { setStartDate(""); setEndDate(""); setFilterUserId("all"); setFilterLeadId(""); setFilterCategory("all"); setLogData(null); setLogPage(1); }} className="h-8">Clear</Button>
          </div>

          {/* Table */}
          {logLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : logData ? (
            <>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Time</th>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">User</th>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Lead ID</th>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Category</th>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">Action</th>
                      <th className="px-3 py-2 text-left font-medium text-xs text-muted-foreground">IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logData.data.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground text-sm">No records found</td></tr>
                    ) : logData.data.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(row.createdAt), "MMM d, yyyy HH:mm")}</td>
                        <td className="px-3 py-2 text-xs">{row.userName ?? <span className="text-muted-foreground">System</span>}</td>
                        <td className="px-3 py-2 text-xs">{row.leadId ? <span className="font-mono">#{row.leadId}</span> : "—"}</td>
                        <td className="px-3 py-2"><CategoryBadge category={row.fieldCategory} /></td>
                        <td className="px-3 py-2"><ActionBadge action={row.action} /></td>
                        <td className="px-3 py-2 text-xs text-muted-foreground font-mono">{row.ip ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{logData.total} total records</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={logPage <= 1} onClick={() => { const p = logPage - 1; setLogPage(p); fetchLog(p); }}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span>Page {logData.page} of {logData.pages}</span>
                  <Button variant="outline" size="sm" disabled={logPage >= logData.pages} onClick={() => { const p = logPage + 1; setLogPage(p); fetchLog(p); }}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-muted-foreground text-sm">Click Search to load the PII access log</div>
          )}
        </CardContent>
      </Card>

      {/* Data Retention Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Data Retention Policy</CardTitle>
          <CardDescription>
            Leads with status <Badge variant="outline">declined</Badge> older than the configured retention window (no credit pulls, no compliance holds) are eligible for purge.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Retention Period (months)</label>
              <Input
                type="number"
                min={1}
                value={retentionMonths}
                onChange={(e) => setRetentionMonths(e.target.value)}
                placeholder="36"
                className="h-8 text-sm w-28"
              />
            </div>
            <Button size="sm" className="h-8" onClick={handleSaveRetention} disabled={savingRetention}>
              {savingRetention ? "Saving…" : "Save Policy"}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleFetchPreview} disabled={previewLoading} className="gap-1.5">
              <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
              {previewLoading ? "Loading…" : "Preview Eligible Records"}
            </Button>
          </div>

          {preview && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-amber-50 border-amber-200">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-900">
                    {preview.eligibleCount} lead{preview.eligibleCount !== 1 ? "s" : ""} eligible for purge
                  </p>
                  <p className="text-xs text-amber-700">
                    Cutoff: {format(new Date(preview.cutoffDate), "MMM d, yyyy")} · Retention: {preview.retentionMonths} months · Excludes any with credit pulls or compliance obligations
                  </p>
                </div>
              </div>

              {preview.eligibleCount > 0 && (
                <>
                  <div className="rounded-md border overflow-x-auto max-h-48">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Lead ID</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Name</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Last Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.eligible.map((l) => (
                          <tr key={l.id} className="border-t">
                            <td className="px-3 py-1.5 text-xs font-mono">#{l.id}</td>
                            <td className="px-3 py-1.5 text-xs">{l.name}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{l.email ?? "—"}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{format(new Date(l.lastUpdated), "MMM d, yyyy")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button variant="destructive" size="sm" onClick={handlePurge} disabled={purging} className="gap-1.5">
                    <Trash2 className="h-4 w-4" />
                    {purging ? "Purging…" : `Purge ${preview.eligibleCount} Record${preview.eligibleCount !== 1 ? "s" : ""}`}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right to be Forgotten */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4" /> Right to be Forgotten (RTBF)</CardTitle>
          <CardDescription>
            Scrub PII from a specific lead on request. The lead record shell is preserved if FCRA compliance logs exist; PII fields are nulled. Navigate to a lead and use the Consent tab to trigger per-lead RTBF.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-blue-50 border-blue-200 p-4 text-sm text-blue-900 space-y-1">
            <p className="font-medium">How RTBF works:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-800 text-xs">
              <li>Lead fields nulled: first/last name, email, phone, company, EIN, consent IP</li>
              <li>Application fields scrubbed: owner name, SSN, DOB, home address, signature</li>
              <li>If credit compliance log entries exist (FCRA): lead record is preserved but PII is still scrubbed</li>
              <li>Credit compliance log rows and credit pull records are never deleted (FCRA requirement)</li>
              <li>All RTBF actions are logged to the activity log with admin identity and timestamp</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
