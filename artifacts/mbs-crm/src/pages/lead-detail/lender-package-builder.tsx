import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronDown, ChevronUp, Download, Eye, GripVertical, Loader2, RotateCcw, Send, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { type DocumentCategory, getGetLeadPackageConfigQueryKey, getGetLeadSubmissionsQueryKey, getGetLenderMatchesQueryKey, getListDocumentsQueryKey, useBuildSelectedLenderPackage, useCreateLeadSubmission, useGetLeadPackageConfig, useGetLenderMatches, useListDocuments, useResetLeadPackageConfig, useSaveLeadPackageConfig, useUpdateDocumentCategory, useUploadDocument } from "@workspace/api-client-react";
import { appendUploadedDocument, defaultBuilderConfig, initializeBuilderConfig, type BuilderConfig, type BuilderSection } from "./lender-package-config";

const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const sections = [
  ["cover", "Cover page"], ["application", "Application (signed)"], ["invoice_quote", "Invoice / quote"],
  ["bank_statement", "Bank statements"], ["drivers_license", "Driver's license"], ["tax_return", "Tax returns"], ["other", "Other documents"],
] as const;
const categories = sections.filter(([key]) => key !== "cover" && key !== "application").map(([value, label]) => ({ value, label }));
type SectionKey = BuilderSection;
type PackageConfig = BuilderConfig;
const defaults = defaultBuilderConfig;

function errorMessage(error: unknown, fallback: string) {
  return (error as any)?.data?.error ?? (error as any)?.message ?? fallback;
}

export function LenderPackageBuilderDialog({ leadId, open, onOpenChange, submitMode = false }: {
  leadId: number; open: boolean; onOpenChange: (open: boolean) => void; submitMode?: boolean;
}) {
  const { toast } = useToast();
  const client = useQueryClient();
  const { data: documentData, isPending: documentsPending } = useListDocuments(leadId, { query: { queryKey: getListDocumentsQueryKey(leadId), enabled: open } });
  const { data: savedConfig, isPending: configPending } = useGetLeadPackageConfig(leadId, { query: { queryKey: getGetLeadPackageConfigQueryKey(leadId), enabled: open } });
  const documents = documentData ?? [];
  const { data: matches = [] } = useGetLenderMatches(leadId, { query: { queryKey: getGetLenderMatchesQueryKey(leadId), enabled: open && submitMode } });
  const upload = useUploadDocument();
  const buildPackage = useBuildSelectedLenderPackage();
  const createSubmission = useCreateLeadSubmission();
  const resetPackageConfig = useResetLeadPackageConfig();
  const savePackageConfig = useSaveLeadPackageConfig();
  const recategorize = useUpdateDocumentCategory();
  const fileRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<PackageConfig>(() => defaults([]));
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [lenderId, setLenderId] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const initializedSession = useRef(false);
  const suppressNextSave = useRef(false);

  useEffect(() => {
    if (!open) { initializedSession.current = false; return; }
    if (initializedSession.current) return;
    const next = initializeBuilderConfig(documentData, savedConfig, documentsPending, configPending);
    if (!next) return;
    setConfig(next);
    initializedSession.current = true;
  }, [open, leadId, savedConfig, documentData, documentsPending, configPending]);

  const persistConfig = async (next: PackageConfig) => {
    const saved = await savePackageConfig.mutateAsync({ id: leadId, data: next });
    client.setQueryData(getGetLeadPackageConfigQueryKey(leadId), saved);
    return saved;
  };

  useEffect(() => {
    if (!open || !initializedSession.current) return;
    if (suppressNextSave.current) { suppressNextSave.current = false; return; }
    const timer = window.setTimeout(() => { void persistConfig(config); }, 450);
    return () => window.clearTimeout(timer);
  }, [config, leadId, open]);

  const docsFor = (section: SectionKey) => documents.filter((doc: any) => doc.category === section);
  const orderedDocs = useMemo(() => config.documentIds.map((id) => documents.find((doc: any) => doc.id === id)).filter(Boolean), [config.documentIds, documents]);
  const toggleSection = (section: SectionKey, checked: boolean) => setConfig((current) => ({ ...current, sections: checked ? [...new Set([...current.sections, section])] : current.sections.filter((key) => key !== section) }));
  const toggleDoc = (id: number, checked: boolean) => setConfig((current) => ({ ...current, documentIds: checked ? [...current.documentIds, id] : current.documentIds.filter((value) => value !== id) }));
  const move = (id: number, direction: -1 | 1) => setConfig((current) => {
    const index = current.documentIds.indexOf(id); if (index < 0) return current;
    const same = docsFor((documents.find((doc: any) => doc.id === id) as any)?.category).map((doc: any) => doc.id);
    const neighbour = same[same.indexOf(id) + direction]; if (!neighbour) return current;
    const next = [...current.documentIds]; const neighbourIndex = next.indexOf(neighbour); [next[index], next[neighbourIndex]] = [next[neighbourIndex], next[index]];
    return { ...current, documentIds: next };
  });
  const build = async (disposition: "preview" | "download") => {
    setLoading(true);
    try {
      const bytes = await buildPackage.mutateAsync({ id: leadId, data: config });
      const url = URL.createObjectURL(bytes);
      if (disposition === "preview") window.open(url, "_blank", "noopener");
      else { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `MBS-Application-${leadId}.pdf`; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast({ title: "Package build failed", description: errorMessage(error, "Could not build lender package"), variant: "destructive" }); }
    finally { setLoading(false); }
  };
  const uploadInside = () => {
    if (!file) return;
    upload.mutate({ id: leadId, data: { file, category } }, { onSuccess: (added: any) => {
      client.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) });
      if (added?.id) setConfig((current) => appendUploadedDocument(current, added.id));
      setFile(null); if (fileRef.current) fileRef.current.value = "";
    }, onError: (error) => toast({ title: "Upload failed", description: errorMessage(error, "Could not add document"), variant: "destructive" }) });
  };
  const send = async () => {
    if (!lenderId) return;
    setLoading(true);
    try {
      // A send is a durable user action: do not rely on the debounce to carry
      // its selected snapshot into the lead's persisted builder preference.
      await persistConfig(config);
      await createSubmission.mutateAsync({ id: leadId, data: { lender_id: Number(lenderId), package_config: config } });
      client.invalidateQueries({ queryKey: getGetLeadSubmissionsQueryKey(leadId) });
      toast({ title: "Submitted to lender" }); onOpenChange(false);
    } catch (error) { toast({ title: "Submission failed", description: errorMessage(error, "Could not send lender package"), variant: "destructive" }); }
    finally { setLoading(false); setConfirming(false); }
  };
  const estimate = Math.max(1, config.sections.filter((section) => section === "cover" || section === "application").length + orderedDocs.filter((doc: any) => config.sections.includes(doc.category)).length);

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>{submitMode ? "Build and submit lender package" : "Build lender package"}</DialogTitle><DialogDescription>Choose exactly what this package contains. Your selections are saved for this lead.</DialogDescription></DialogHeader>
    <div className="space-y-3">{sections.map(([key, label]) => {
      const sectionDocs = docsFor(key); const available = key === "cover" || key === "application" || sectionDocs.length > 0; const enabled = config.sections.includes(key);
      return <div key={key} className={`rounded-lg border p-3 ${available ? "" : "bg-muted/40 opacity-60"}`}><div className="flex items-center gap-3">
        <Checkbox checked={enabled} disabled={!available} onCheckedChange={(value) => toggleSection(key, value === true)} />
        <div className="flex-1 font-medium text-sm">{label}<span className="ml-2 text-xs text-muted-foreground">{available ? `${sectionDocs.length || (key === "cover" || key === "application" ? 1 : 0)} included item${sectionDocs.length === 1 ? "" : "s"}` : "none on file"}</span></div>
      </div>{sectionDocs.map((doc: any) => <div key={doc.id} draggable onDragStart={() => setDraggedId(doc.id)} onDragOver={(e) => { const source = documents.find((item: any) => item.id === draggedId); if (source?.category === doc.category) e.preventDefault(); }} onDrop={() => { const source = documents.find((item: any) => item.id === draggedId); if (draggedId && draggedId !== doc.id && source?.category === doc.category) { const from = config.documentIds.indexOf(draggedId), to = config.documentIds.indexOf(doc.id); const next = [...config.documentIds]; next.splice(from, 1); next.splice(to, 0, draggedId); setConfig({ ...config, documentIds: next }); } }} className="mt-2 ml-7 flex items-center gap-2 text-sm">
        <GripVertical className="h-4 w-4 text-muted-foreground" /><Checkbox checked={config.documentIds.includes(doc.id)} onCheckedChange={(value) => toggleDoc(doc.id, value === true)} /><span className="flex-1 truncate">{doc.filename} <span className="text-xs text-muted-foreground">· {(doc.fileSize / 1024).toFixed(1)} KB · {format(new Date(doc.createdAt), "MMM d, yyyy")}</span></span>
        <Button variant="ghost" size="icon" aria-label={`Move ${doc.filename} up`} onClick={() => move(doc.id, -1)}><ChevronUp className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Move ${doc.filename} down`} onClick={() => move(doc.id, 1)}><ChevronDown className="h-4 w-4" /></Button>
        <Select value={doc.category} onValueChange={(value) => recategorize.mutate({ docId: doc.id, data: { category: value as DocumentCategory } }, { onSuccess: () => client.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) }) })}><SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger><SelectContent>{categories.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
      </div>)}</div>;
    })}</div>
    <div className="rounded-lg border border-dashed p-3"><div className="text-sm font-medium mb-2">Add document</div><div className="flex flex-wrap gap-2 items-center"><Input ref={fileRef} type="file" className="max-w-xs" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent>{categories.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!file || upload.isPending} onClick={uploadInside}><Upload className="h-4 w-4 mr-1" />Add</Button></div></div>
    <div className="grid gap-2 sm:grid-cols-2"><label className="flex items-center justify-between rounded border p-2 text-sm">Cover page <Switch checked={config.options.includeCoverPage} onCheckedChange={(includeCoverPage) => setConfig({ ...config, options: { ...config.options, includeCoverPage } })} /></label><label className="flex items-center justify-between rounded border p-2 text-sm">Footer each page <Switch checked={config.options.includeFooter} onCheckedChange={(includeFooter) => setConfig({ ...config, options: { ...config.options, includeFooter } })} /></label></div>
    {submitMode && <div className="rounded-lg bg-muted/40 p-3"><label className="text-sm font-medium">Lender</label><Select value={lenderId} onValueChange={setLenderId}><SelectTrigger className="mt-1"><SelectValue placeholder="Select one active lender" /></SelectTrigger><SelectContent>{matches.filter((match: any) => match.lender?.isActive !== false).map((match: any) => <SelectItem key={match.lenderId} value={String(match.lenderId)}>{match.lender?.name} — {match.matchScore}% · {(match.criteriaBreakdown ?? []).filter((criterion: any) => criterion.passed).length} matching reasons</SelectItem>)}</SelectContent></Select></div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"><span className="text-sm text-muted-foreground">Estimated pages: {estimate}</span><Button variant="link" onClick={() => { suppressNextSave.current = true; setConfig(defaults(documents)); void resetPackageConfig.mutateAsync({ id: leadId }).then(() => { client.setQueryData(getGetLeadPackageConfigQueryKey(leadId), { packageConfig: null }); return client.invalidateQueries({ queryKey: getGetLeadPackageConfigQueryKey(leadId) }); }).catch((error) => toast({ title: "Could not reset saved package", description: errorMessage(error, "Please try again"), variant: "destructive" })); }}><RotateCcw className="h-4 w-4 mr-1" />Reset to defaults</Button><div className="flex gap-2"><Button variant="outline" disabled={loading} onClick={() => build("preview")}><Eye className="h-4 w-4 mr-1" />Preview</Button><Button variant="outline" disabled={loading} onClick={() => build("download")}><Download className="h-4 w-4 mr-1" />Download</Button>{submitMode && <Button disabled={loading || !lenderId} onClick={() => setConfirming(true)}><Send className="h-4 w-4 mr-1" />Send</Button>}</div></div>
    <Dialog open={confirming} onOpenChange={setConfirming}><DialogContent><DialogHeader><DialogTitle>Send lender package?</DialogTitle><DialogDescription>The selected package will be stored exactly as sent and emailed to the selected lender.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button><Button disabled={loading} onClick={send}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" />Confirm send</>}</Button></div></DialogContent></Dialog>
  </DialogContent></Dialog>;
}