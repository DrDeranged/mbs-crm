import { useEffect, useRef, useState } from "react";
import { useGetMe, useListLeads, useListEmailTemplates } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Link as LinkIcon, Mail, Archive, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { InlineListError } from "@/components/inline-list-error";
import { listPayload } from "@/lib/list-response";

const api = getApiBaseUrl();
type Template = { id: number; name: string; category: string; kind: string; status: string; thumbnailUrl?: string | null };
type Render = { renderId: number; pdfUrl: string; pngUrl: string; shareUrl: string; rep: { name: string; title: string; phone: string; email: string } };
type LoadError = { status?: number | string; detail: string };

export default function Documents() {
  const { data: me } = useGetMe();
  const { data: leadData } = useListLeads({ limit: 100 });
  const { data: emailTemplates } = useListEmailTemplates({ isActive: true });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<LoadError | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [render, setRender] = useState<Render | null>(null);
  const [repId, setRepId] = useState("me");
  const [emailOpen, setEmailOpen] = useState(false);
  const [leadId, setLeadId] = useState("");
  const collateralTemplate = emailTemplates?.find(t => /collateral/i.test(t.name));
  const [subject, setSubject] = useState("A resource for your business");
  const [bodyHtml, setBodyHtml] = useState("Hi,\\n\\nI thought this resource may be helpful for your business.");
  const [sending, setSending] = useState(false);
  const [reps, setReps] = useState<{ id: number; name: string | null; email: string }[]>([]);
  const [repsError, setRepsError] = useState<LoadError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const admin = me?.role === "admin";
  const load = async () => {
    try {
      const response = await fetch(`${api}/collateral/templates?includeDrafts=${admin}`, { credentials: "include" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTemplates([]);
        setTemplatesError({ status: response.status, detail: "The collateral library could not be loaded." });
        return;
      }
      const result = listPayload<Template>(payload);
      if (result.malformed) {
        setTemplates([]);
        setTemplatesError({ status: response.status, detail: "The server returned an unexpected collateral response." });
        return;
      }
      setTemplates(result.items);
      setTemplatesError(null);
    } catch {
      setTemplates([]);
      setTemplatesError({ status: "network", detail: "The collateral library could not be reached." });
    }
  };
  const loadReps = async () => {
    if (!admin) {
      setReps([]);
      setRepsError(null);
      return;
    }
    try {
      const response = await fetch(`${api}/users?role=rep&isActive=true`, { credentials: "include" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setReps([]);
        setRepsError({ status: response.status, detail: "The representative list could not be loaded." });
        return;
      }
      const result = listPayload<{ id: number; name: string | null; email: string }>(payload, ["users"]);
      if (result.malformed) {
        setReps([]);
        setRepsError({ status: response.status, detail: "The server returned an unexpected representative response." });
        return;
      }
      setReps(result.items);
      setRepsError(null);
    } catch {
      setReps([]);
      setRepsError({ status: "network", detail: "The representative list could not be reached." });
    }
  };
  useEffect(() => { void load(); }, [admin]);
  useEffect(() => { void loadReps(); }, [admin]);
  useEffect(() => {
    if (!selected) return setRender(null);
    const q = admin && repId !== "me" ? `?repId=${repId}` : "";
    fetch(`${api}/collateral/templates/${selected.id}/render${q}`, { credentials: "include" }).then(r => r.json()).then(setRender);
  }, [selected, repId, admin]);
  const action = async (path: string, method = "POST") => {
    const response = await fetch(`${api}${path}`, { method, credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      toast({ title: "Update failed", description: payload.error || "Try again.", variant: "destructive" });
      return;
    }
    await load();
  };
  const upload = async () => {
    const file = fileRef.current?.files?.[0]; if (!file) return;
    try {
      const kind = file.type === "text/html" ? "html" : "image_overlay";
      if (kind === "image_overlay" && !["image/png", "application/pdf"].includes(file.type)) { toast({ title: "Choose a PNG or PDF", variant: "destructive" }); return; }
      const requestResponse = await fetch(`${api}/storage/uploads/request-url`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type }) });
    if (!requestResponse.ok) throw new Error("Could not request upload URL");
    const requested = await requestResponse.json();
    const uploadResponse = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!uploadResponse.ok) throw new Error("Object storage upload failed");
    const createResponse = await fetch(`${api}/collateral/templates`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, ""), category: "flyer", kind, sourceKey: requested.fileKey, status: "draft" }) });
      if (!createResponse.ok) throw new Error((await createResponse.json()).error || "Could not create draft template");
      if (fileRef.current) fileRef.current.value = ""; await load(); toast({ title: "Draft uploaded" });
    } catch (error) {
      toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  };
  const copy = async () => {
    if (!render) return;
    const response = await fetch(`${api}${render.shareUrl}`, { credentials: "include" });
    if (!response.ok) {
      toast({ title: "Could not create link", variant: "destructive" });
      return;
    }
    const payload = await response.json();
    await navigator.clipboard.writeText(payload.url);
    toast({ title: "Signed link copied", description: "The link expires in 7 days." });
  };
  useEffect(() => { if (collateralTemplate) { setSubject(collateralTemplate.subject); setBodyHtml(collateralTemplate.bodyHtml); } }, [collateralTemplate]);
  const leads = listPayload<any>(leadData, ["leads", "items"]).items;
  const sendEmail = async () => {
    if (!render || !leadId) return;
    setSending(true);
    try {
      const response = await fetch(`${api}/collateral/renders/${render.renderId}/email`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: Number(leadId), subject, bodyHtml }) });
      if (!response.ok) throw new Error((await response.json()).error || "Email failed");
      setEmailOpen(false); toast({ title: "Collateral emailed" });
    } catch (error) { toast({ title: "Email failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
    finally { setSending(false); }
  };
  return <div className="p-6 space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Documents</h1><p className="text-muted-foreground">Rep-personalized collateral library</p></div>{admin && <div className="flex items-center gap-2"><Input ref={fileRef} type="file" accept=".png,.pdf,.html,text/html,image/png,application/pdf" className="w-64" /><Button onClick={() => void upload()}><Upload className="mr-2 h-4 w-4" />Upload template</Button></div>}</div>
    {templatesError && <InlineListError title="Couldn’t load documents" status={templatesError.status} detail={templatesError.detail} onRetry={() => void load()} />}
    {repsError && <InlineListError title="Couldn’t load representatives" status={repsError.status} detail={repsError.detail} onRetry={() => void loadReps()} />}
    {admin && reps.length > 0 && <div className="max-w-xs"><label className="text-sm font-medium">View version for</label><Select value={repId} onValueChange={setRepId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="me">My version</SelectItem>{reps.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name || r.email}</SelectItem>)}</SelectContent></Select></div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{templates.map(t => <Card key={t.id} className="cursor-pointer hover:border-primary" onClick={() => setSelected(t)}><div className="h-40 bg-muted flex items-center justify-center overflow-hidden">{t.thumbnailUrl ? <img src={t.thumbnailUrl} className="h-full w-full object-cover" /> : <span className="text-4xl text-muted-foreground">▤</span>}</div><CardHeader><div className="flex justify-between"><CardTitle>{t.name}</CardTitle><Badge variant="outline">{t.category}</Badge></div><p className="text-sm text-muted-foreground">{t.kind === "html" ? "HTML template" : "Image overlay"} · {t.status}</p></CardHeader>{admin && <CardContent className="flex gap-2"><Button size="sm" onClick={e => { e.stopPropagation(); void action(`/collateral/templates/${t.id}/${t.status === "published" ? "archive" : "publish"}`); }}>{t.status === "published" ? <><Archive className="mr-1 h-3 w-3" />Archive</> : "Publish"}</Button></CardContent>}</Card>)}</div>
    {selected && <Card><CardHeader><CardTitle>{selected.name} <Badge className="ml-2">MY VERSION</Badge></CardTitle></CardHeader><CardContent>{render ? <><p className="mb-4 text-sm text-muted-foreground">{render.rep.name}{render.rep.title && ` · ${render.rep.title}`} · {render.rep.email}</p><div className="flex flex-wrap gap-2"><Button asChild><a href={`${api}${render.pdfUrl}`}><Download className="mr-2 h-4 w-4" />Download PDF</a></Button><Button variant="outline" asChild><a href={`${api}${render.pngUrl}`}><Download className="mr-2 h-4 w-4" />Download PNG</a></Button><Button variant="outline" onClick={() => void copy()}><LinkIcon className="mr-2 h-4 w-4" />Copy 7-day link</Button><Button variant="outline" onClick={() => setEmailOpen(true)}><Mail className="mr-2 h-4 w-4" />Email to lead</Button></div></> : <p>Preparing your personalized version…</p>}</CardContent></Card>}
    {emailOpen && render && <Card><CardHeader><CardTitle>Email collateral to a lead</CardTitle></CardHeader><CardContent className="space-y-3"><Select value={leadId} onValueChange={setLeadId}><SelectTrigger><SelectValue placeholder="Choose a lead" /></SelectTrigger><SelectContent>{leads.filter((l: any) => l.email).map((l: any) => <SelectItem key={l.id} value={String(l.id)}>{l.firstName} {l.lastName} · {l.email}</SelectItem>)}</SelectContent></Select><Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" /><textarea className="min-h-32 w-full rounded-md border p-3 text-sm" value={bodyHtml} onChange={e => setBodyHtml(e.target.value)} /><div className="flex gap-2"><Button onClick={() => void sendEmail()} disabled={!leadId || sending}>{sending ? "Sending…" : "Send with PDF"}</Button><Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button></div></CardContent></Card>}
  </div>;
}