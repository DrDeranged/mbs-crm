import { useEffect, useState } from "react";
import { RefreshCw, Play, RotateCcw } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Intake = {
  settings: { usfaSheetId: string | null; usfaSheetTab: string };
  counts: { total: number; ok: number; dup: number; error: number; lastRun: string | null };
  logs: Array<{ id: number; externalId: string; rowNumber: number; ingestedAt: string; leadId: number | null; status: string; error: string | null }>;
};

export default function AdminUsfaIntake() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const [data, setData] = useState<Intake | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = async () => {
    const response = await fetch(`${getApiBaseUrl()}/admin/usfa-intake`, { credentials: "include" });
    if (response.ok) setData(await response.json());
  };
  useEffect(() => { if (me?.role === "admin") void load(); }, [me?.role]);
  if (meLoading) return <div className="p-8">Loading…</div>;
  if (me?.role !== "admin") return <div className="p-8 text-red-600">Admin access required.</div>;
  const run = async (url: string, method: string = "POST") => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}${url}`, { method, credentials: "include" });
      const result = await response.json();
      setMessage(response.ok ? `Completed: ${result.status ?? "ok"}` : result.error ?? "Request failed");
      await load();
    } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Administration</p><h1 className="text-3xl font-bold text-[#0E2A47]">USFA Intake</h1><p className="mt-1 text-sm text-muted-foreground">Read-only Google Sheet poll and idempotent row receipts.</p></div>
        <Button onClick={() => void run("/admin/usfa-intake/run")} disabled={busy}><Play className="mr-2 h-4 w-4" />Run now</Button>
      </div>
      {message && <div className="rounded-lg border bg-muted/30 p-3 text-sm">{message}</div>}
      <div className="grid gap-4 sm:grid-cols-4">
        {data && [["Total", data.counts.total], ["Imported", data.counts.ok], ["Duplicates", data.counts.dup], ["Errors", data.counts.error]].map(([label, value]) => <Card key={label as string}><CardContent className="p-5"><p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle>Connection</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-2"><div><span className="text-muted-foreground">Sheet ID:</span> {data?.settings.usfaSheetId ?? "Not configured"}</div><div><span className="text-muted-foreground">Tab:</span> {data?.settings.usfaSheetTab ?? "Sheet1"}</div><div><span className="text-muted-foreground">Last row activity:</span> {data?.counts.lastRun ? new Date(data.counts.lastRun).toLocaleString() : "Never"}</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Row log</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/30"><tr><th className="p-3">External ID</th><th className="p-3">Row</th><th className="p-3">Status</th><th className="p-3">Lead</th><th className="p-3">Received</th><th className="p-3" /></tr></thead><tbody>{data?.logs.map((log) => <tr key={log.id} className="border-b last:border-0"><td className="p-3 font-mono">{log.externalId}</td><td className="p-3">{log.rowNumber}</td><td className="p-3">{log.status}</td><td className="p-3">{log.leadId ?? "—"}</td><td className="p-3">{new Date(log.ingestedAt).toLocaleString()}</td><td className="p-3">{log.status === "error" && <Button size="sm" variant="outline" onClick={() => void run(`/admin/usfa-intake/${log.id}/reprocess`)} disabled={busy}><RotateCcw className="mr-1 h-3 w-3" />Reprocess</Button>}</td></tr>)}</tbody></table>{!data?.logs.length && <div className="p-8 text-center text-muted-foreground">No USFA rows have been received.</div>}</CardContent></Card>
      <Button variant="ghost" onClick={() => void load()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
  );
}