import { useEffect, useState } from "react";
import { RefreshCw, Play, RotateCcw, Save } from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Intake = {
  settings: { usfaSheetId: string | null; usfaSheetTab: string; usfaConsentConfirmed: boolean; usfaWebhookEnabled: boolean };
  serviceAccountConfigured: boolean;
  counts: { total: number; ok: number; dup: number; error: number; lastRun: string | null };
  logs: Array<{ id: number; externalId: string; rowNumber: number; ingestedAt: string; leadId: number | null; status: string; error: string | null }>;
};

export default function AdminUsfaIntake() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const [data, setData] = useState<Intake | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetTab, setSheetTab] = useState("Sheet1");
  const [connectionDirty, setConnectionDirty] = useState(false);
  const load = async () => {
    const response = await fetch(`${getApiBaseUrl()}/admin/usfa-intake`, { credentials: "include" });
    if (response.ok) setData(await response.json());
  };
  useEffect(() => { if (me?.role === "admin") void load(); }, [me?.role]);
  useEffect(() => {
    if (!data || connectionDirty) return;
    setSheetId(data.settings.usfaSheetId ?? "");
    setSheetTab(data.settings.usfaSheetTab);
  }, [data?.settings.usfaSheetId, data?.settings.usfaSheetTab, connectionDirty]);
  if (meLoading) return <div className="p-8">Loading…</div>;
  if (me?.role !== "admin") return <div className="p-8 text-red-600">Admin access required.</div>;
  const saveConnection = async () => {
    if (!sheetTab.trim()) { setMessage("Tab is required."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}/settings/company`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usfaSheetId: sheetId.trim() || null, usfaSheetTab: sheetTab.trim() }),
      });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "Unable to save the sheet settings."); return; }
      setData(current => current ? {
        ...current, settings: { ...current.settings, usfaSheetId: result.usfaSheetId, usfaSheetTab: result.usfaSheetTab },
      } : current);
      setConnectionDirty(false);
      setMessage("Sheet connection settings saved.");
    } catch {
      setMessage("Unable to save the sheet settings.");
    } finally { setBusy(false); }
  };
  const testConnection = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}/admin/usfa-intake/test-connection`, {
        method: "POST", credentials: "include",
      });
      const result = await response.json();
      setMessage(response.ok
        ? `Connected: ${result.columnCount} column${result.columnCount === 1 ? "" : "s"} in the header row.`
        : result.error ?? "Could not test the sheet connection.");
    } catch {
      setMessage("Could not test the sheet connection.");
    } finally { setBusy(false); }
  };
  const run = async (url: string, method: string = "POST") => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}${url}`, { method, credentials: "include" });
      const result = await response.json();
      setMessage(response.ok ? `Completed: ${result.status ?? "ok"}` : result.error ?? "Request failed");
      await load();
    } finally { setBusy(false); }
  };
  const setConsent = async (confirmed: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}/settings/company`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usfaConsentConfirmed: confirmed }),
      });
      setMessage(response.ok ? (confirmed ? "USFA consent confirmed; SMS and drip are now allowed." : "USFA consent confirmation revoked; SMS and drip are blocked.") : "Unable to update USFA consent setting.");
      await load();
    } finally { setBusy(false); }
  };
  const setWebhook = async (enabled: boolean) => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`${getApiBaseUrl()}/settings/company`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usfaWebhookEnabled: enabled }),
      });
      setMessage(response.ok ? (enabled ? "USFA webhook enabled." : "USFA webhook disabled.") : "Unable to update USFA webhook setting.");
      await load();
    } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Administration</p><h1 className="text-3xl font-bold text-[#0E2A47]">USFA Intake</h1><p className="mt-1 text-sm text-muted-foreground">Read-only Google Sheet poll and idempotent row receipts.</p></div>
        <Button onClick={() => void run("/admin/usfa-intake/run")} disabled={busy}><Play className="mr-2 h-4 w-4" />Run now</Button>
      </div>
      {message && <div role="status" aria-live="polite" className="rounded-lg border bg-muted/30 p-3 text-sm">{message}</div>}
      <div className="grid gap-4 sm:grid-cols-4">
        {data && [["Total", data.counts.total], ["Imported", data.counts.ok], ["Duplicates", data.counts.dup], ["Errors", data.counts.error]].map(([label, value]) => <Card key={label as string}><CardContent className="p-5"><p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-bold">{value}</p></CardContent></Card>)}
      </div>
      <Card><CardHeader><CardTitle>Connection</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
        {!data ? <p className="text-muted-foreground">Loading connection settings…</p> : <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><span className="text-muted-foreground">Google service account:</span> {data.serviceAccountConfigured ? "Present" : "Absent"}</div>
            <div><span className="text-muted-foreground">Last row activity:</span> {data.counts.lastRun ? new Date(data.counts.lastRun).toLocaleString() : "Never"}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="usfa-sheet-id" className="font-medium">Sheet ID</label><Input id="usfa-sheet-id" value={sheetId} maxLength={256} placeholder="Paste the Google Sheet ID" onChange={event => { setSheetId(event.target.value); setConnectionDirty(true); }} /></div>
            <div className="space-y-1.5"><label htmlFor="usfa-sheet-tab" className="font-medium">Tab</label><Input id="usfa-sheet-tab" value={sheetTab} maxLength={100} onChange={event => { setSheetTab(event.target.value); setConnectionDirty(true); }} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void saveConnection()} disabled={busy || !connectionDirty}><Save className="mr-2 h-4 w-4" />Save</Button>
            <Button variant="outline" onClick={() => void testConnection()} disabled={busy || connectionDirty}>Test connection</Button>
            {connectionDirty && <span className="text-muted-foreground">Save changes before testing the connection.</span>}
          </div>
        </>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Consent compliance guard</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">USFA has not confirmed SMS consent. Until an administrator explicitly confirms it, all USFA SMS sends and drip enrollment/automation remain blocked. Email and calls are still allowed.</p>
        <Button variant={data?.settings.usfaConsentConfirmed ? "default" : "outline"} onClick={() => void setConsent(!data?.settings.usfaConsentConfirmed)} disabled={busy}>
          {data?.settings.usfaConsentConfirmed ? "Consent confirmed — disable guard" : "Confirm USFA consent and enable SMS/drip"}
        </Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Dormant vendor webhook</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">The webhook accepts only HMAC-authenticated USFA payloads. Keep it disabled until the vendor secret and payload contract are confirmed.</p>
        <Button variant={data?.settings.usfaWebhookEnabled ? "default" : "outline"} onClick={() => void setWebhook(!data?.settings.usfaWebhookEnabled)} disabled={busy}>
          {data?.settings.usfaWebhookEnabled ? "Webhook enabled — disable" : "Enable USFA webhook"}
        </Button>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Row log</CardTitle></CardHeader><CardContent className="overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/30"><tr><th className="p-3">External ID</th><th className="p-3">Row</th><th className="p-3">Status</th><th className="p-3">Lead</th><th className="p-3">Received</th><th className="p-3" /></tr></thead><tbody>{data?.logs.map((log) => <tr key={log.id} className="border-b last:border-0"><td className="p-3 font-mono">{log.externalId}</td><td className="p-3">{log.rowNumber}</td><td className="p-3">{log.status}</td><td className="p-3">{log.leadId ?? "—"}</td><td className="p-3">{new Date(log.ingestedAt).toLocaleString()}</td><td className="p-3">{log.status === "error" && <Button size="sm" variant="outline" onClick={() => void run(`/admin/usfa-intake/${log.id}/reprocess`)} disabled={busy}><RotateCcw className="mr-1 h-3 w-3" />Reprocess</Button>}</td></tr>)}</tbody></table>{!data?.logs.length && <div className="p-8 text-center text-muted-foreground">No USFA rows have been received.</div>}</CardContent></Card>
      <Button variant="ghost" onClick={() => void load()} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
  );
}