import { useEffect, useMemo, useRef, useState } from "react";
import { useGetMe, useListEmailTemplates, useListLeads } from "@workspace/api-client-react";
import {
  Archive,
  Check,
  ChevronsUpDown,
  Download,
  Eye,
  FileText,
  Link as LinkIcon,
  Loader2,
  Mail,
  RefreshCw,
  Upload,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InlineListError } from "@/components/inline-list-error";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl, resolveApiUrl } from "@/lib/apiBase";
import { fetchAuthenticatedBlob, safeDownloadFilename, saveBlob } from "@/lib/fileDownload";
import { listPayload } from "@/lib/list-response";
import { cn } from "@/lib/utils";
import { CampaignLibraryFlyerPicker, type CampaignLibraryFlyerSelection } from "@/components/campaign-library-flyer-picker";
import {
  FLYER_AUDIENCES, FLYER_CATEGORIES, FLYER_VERTICALS,
  getCampaignLibraryFlyerPublicUrl, normalizeFlyerLabel, putFlyerBytes,
  registerCampaignLibraryFlyers, requestFlyerUploadUrls,
  type FlyerAudience, type FlyerCategory, type FlyerVertical,
} from "@/lib/campaignFlyerLibrary";

const api = getApiBaseUrl();

type Template = {
  id: number;
  name: string;
  category: string;
  kind: string;
  status: string;
  thumbnailUrl?: string | null;
};

type CollateralRender = {
  renderId: number;
  pdfUrl: string;
  pngUrl: string;
  shareUrl: string;
  rep: { name: string; title: string; phone: string; email: string };
};

type Lead = {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  email?: string | null;
};

type LoadError = { status?: number | string; detail: string };
type FlyerQueueRow = {
  id: string;
  file: File;
  name: string;
  category: FlyerCategory;
  vertical: FlyerVertical;
  audience: FlyerAudience;
  repId: string;
  status: "ready" | "uploading" | "registered" | "failed";
  error?: string;
};

function leadLabel(lead: Lead): string {
  const person = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return person || lead.businessName || lead.email || `Lead #${lead.id}`;
}

function LeadPicker({
  leads,
  value,
  onChange,
  onSearch,
  loading,
}: {
  leads: Lead[];
  value: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = leads.find((lead) => String(lead.id) === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? `${leadLabel(selected)} · ${selected.email}` : "Choose a lead"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search name, business, or email…"
            onValueChange={onSearch}
          />
          <CommandList className="max-h-72 overscroll-contain">
            <CommandEmpty>{loading ? "Searching leads…" : "No matching leads found."}</CommandEmpty>
            {leads.map((lead) => (
              <CommandItem
                key={lead.id}
                value={`${leadLabel(lead)} ${lead.businessName ?? ""} ${lead.email ?? ""}`}
                onSelect={() => {
                  onChange(String(lead.id));
                  setOpen(false);
                }}
              >
                <Check className={cn("h-4 w-4", value === String(lead.id) ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate">{leadLabel(lead)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{lead.email}</span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Documents() {
  const { data: me } = useGetMe();
  const { data: emailTemplates } = useListEmailTemplates({ isActive: true });
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const admin = me?.role === "admin";

  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesError, setTemplatesError] = useState<LoadError | null>(null);
  const [reps, setReps] = useState<{ id: number; name: string | null; email: string }[]>([]);
  const [repsError, setRepsError] = useState<LoadError | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [render, setRender] = useState<CollateralRender | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [repId, setRepId] = useState("me");
  const [emailOpen, setEmailOpen] = useState(false);
  const [leadId, setLeadId] = useState("");
  const [leadSearch, setLeadSearch] = useState("");
  const [debouncedLeadSearch, setDebouncedLeadSearch] = useState("");
  const [subject, setSubject] = useState("A resource for your business");
  const [bodyHtml, setBodyHtml] = useState("Hi,\n\nI thought this resource may be helpful for your business.");
  const [sending, setSending] = useState(false);
  const [flyerRows, setFlyerRows] = useState<FlyerQueueRow[]>([]);
  const [flyerUploading, setFlyerUploading] = useState(false);
  const [flyerLibraryVersion, setFlyerLibraryVersion] = useState(0);
  const [librarySelection, setLibrarySelection] = useState<CampaignLibraryFlyerSelection | null>(null);
  const [libraryOpening, setLibraryOpening] = useState(false);
  const [libraryOpenError, setLibraryOpenError] = useState("");

  const collateralTemplate = emailTemplates?.find((template) => /collateral/i.test(template.name));
  const { data: leadData, isFetching: leadsLoading } = useListLeads({
    limit: 100,
    ...(debouncedLeadSearch ? { search: debouncedLeadSearch } : {}),
  });
  const leads = useMemo(
    () => listPayload<Lead>(leadData, ["leads", "items"]).items.filter((lead) => Boolean(lead.email)),
    [leadData],
  );

  const loadTemplates = async () => {
    try {
      const response = await fetch(`${api}/collateral/templates?includeDrafts=${admin}`, {
        credentials: "include",
      });
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

  useEffect(() => { void loadTemplates(); }, [admin]);
  useEffect(() => { void loadReps(); }, [admin]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedLeadSearch(leadSearch.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [leadSearch]);
  useEffect(() => {
    if (!collateralTemplate) return;
    setSubject(collateralTemplate.subject);
    setBodyHtml(collateralTemplate.bodyHtml);
  }, [collateralTemplate]);

  useEffect(() => {
    if (!selected) {
      setRender(null);
      setPreviewBlob(null);
      setPreviewUrl(null);
      setRenderError(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setRendering(true);
    setRender(null);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setRenderError(null);
    setEmailOpen(false);

    const preparePreview = async () => {
      try {
        const query = admin && repId !== "me" ? `?repId=${repId}` : "";
        const response = await fetch(`${api}/collateral/templates/${selected.id}/render${query}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `Preview failed (${response.status})`);
        if (!payload?.renderId || !payload?.pdfUrl || !payload?.rep) {
          throw new Error("The server returned an incomplete preview");
        }

        const prepared = payload as CollateralRender;
        const blob = await fetchAuthenticatedBlob(resolveApiUrl(prepared.pdfUrl));
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setRender(prepared);
        setPreviewBlob(blob);
        setPreviewUrl(objectUrl);
      } catch (error) {
        if (!controller.signal.aborted) {
          setRenderError(error instanceof Error ? error.message : "Could not prepare this document");
        }
      } finally {
        if (!controller.signal.aborted) setRendering(false);
      }
    };

    void preparePreview();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected, repId, admin, renderAttempt]);

  const action = async (path: string) => {
    const response = await fetch(`${api}${path}`, { method: "POST", credentials: "include" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      toast({ title: "Update failed", description: payload.error || "Try again.", variant: "destructive" });
      return;
    }
    await loadTemplates();
  };

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    try {
      const kind = file.type === "text/html" ? "html" : "image_overlay";
      if (kind === "image_overlay" && !["image/png", "application/pdf"].includes(file.type)) {
        toast({ title: "Choose a PNG or PDF", variant: "destructive" });
        return;
      }
      const requestResponse = await fetch(`${api}/storage/uploads/request-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type }),
      });
      if (!requestResponse.ok) throw new Error("Could not request upload URL");
      const requested = await requestResponse.json();
      const uploadResponse = await fetch(requested.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error("Object storage upload failed");
      const createResponse = await fetch(`${api}/collateral/templates`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, ""),
          category: "flyer",
          kind,
          sourceKey: requested.fileKey,
          status: "draft",
        }),
      });
      if (!createResponse.ok) throw new Error((await createResponse.json()).error || "Could not create draft template");
      if (fileRef.current) fileRef.current.value = "";
      await loadTemplates();
      toast({ title: "Draft uploaded" });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const addFlyers = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.length > 50) {
      toast({ title: "Choose up to 50 flyers at a time", variant: "destructive" });
      return;
    }
    setFlyerRows(selectedFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: normalizeFlyerLabel(file.name.replace(/\.[^.]+$/, "")),
      category: "equipment_financing",
      vertical: "general",
      audience: "end_user",
      repId: "",
      status: "ready",
      ...(!["image/png", "application/pdf"].includes(file.type) ? { status: "failed" as const, error: "Only PNG and PDF files are supported." } : {}),
    })));
  };

  const updateFlyerRow = (id: string, changes: Partial<FlyerQueueRow>) =>
    setFlyerRows((rows) => rows.map((row) => row.id === id ? { ...row, ...changes } : row));

  const uploadFlyers = async () => {
    if (flyerUploading) return;
    const pending = flyerRows.filter((row) => row.status !== "registered");
    if (!pending.length) return;
    const valid = pending.filter((row) => ["image/png", "application/pdf"].includes(row.file.type));
    for (const row of pending) {
      const error = !["image/png", "application/pdf"].includes(row.file.type) ? "Only PNG and PDF files are supported."
        : !row.name.trim() ? "Enter a flyer name."
        : row.repId && (!Number.isInteger(Number(row.repId)) || Number(row.repId) < 1) ? "Enter a valid rep ID."
        : "";
      if (error) updateFlyerRow(row.id, { status: "failed", error });
    }
    const uploadable = valid.filter((row) => row.name.trim() && (!row.repId || (Number.isInteger(Number(row.repId)) && Number(row.repId) > 0)));
    if (!uploadable.length) return;
    setFlyerUploading(true);
    setFlyerRows((rows) => rows.map((row) => uploadable.some((item) => item.id === row.id) ? { ...row, status: "uploading", error: undefined } : row));
    try {
      const { uploads } = await requestFlyerUploadUrls(uploadable.map((row) => ({
        originalFilename: row.file.name,
        size: row.file.size,
        contentType: row.file.type as "image/png" | "application/pdf",
      })));
      if (!Array.isArray(uploads) || uploads.length !== uploadable.length) throw new Error("The server did not return a URL for every file.");
      await Promise.all(uploadable.map(async (row, index) => {
        try {
          const slot = uploads.find((item) => item.index === index);
          if (!slot?.uploadUrl || !slot.objectPath) throw new Error("Missing upload URL.");
          await putFlyerBytes(slot, row.file);
          const result = await registerCampaignLibraryFlyers([{
            objectPath: slot.objectPath,
            originalFilename: row.file.name,
            name: normalizeFlyerLabel(row.name.trim()),
            category: row.category,
            vertical: row.vertical,
            audience: row.audience,
            ...(row.repId ? { repId: Number(row.repId) } : {}),
          }]);
          if (!result.templates?.length) throw new Error("Registration did not return a flyer.");
          updateFlyerRow(row.id, { status: "registered", error: undefined });
        } catch (error) {
          updateFlyerRow(row.id, { status: "failed", error: error instanceof Error ? error.message : "Upload failed." });
        }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare uploads.";
      for (const row of uploadable) updateFlyerRow(row.id, { status: "failed", error: message });
    } finally {
      setFlyerUploading(false);
      setFlyerLibraryVersion((version) => version + 1);
    }
  };

  const openLibraryFlyer = async () => {
    if (!librarySelection) return;
    setLibraryOpening(true);
    setLibraryOpenError("");
    try {
      const url = await getCampaignLibraryFlyerPublicUrl(librarySelection.templateId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setLibraryOpenError(error instanceof Error ? error.message : "Could not open this flyer.");
    } finally {
      setLibraryOpening(false);
    }
  };

  const downloadPdf = async () => {
    if (!selected || !render) return;
    setDownloading(true);
    try {
      const blob = previewBlob ?? await fetchAuthenticatedBlob(resolveApiUrl(render.pdfUrl));
      saveBlob(blob, safeDownloadFilename(`${selected.name}.pdf`, `collateral-${render.renderId}.pdf`));
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Could not download this PDF.",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const copyLink = async () => {
    if (!render) return;
    const response = await fetch(resolveApiUrl(render.shareUrl), { credentials: "include" });
    if (!response.ok) {
      toast({ title: "Could not create link", variant: "destructive" });
      return;
    }
    const payload = await response.json();
    await navigator.clipboard.writeText(payload.url);
    toast({ title: "Signed link copied", description: "The link expires in 7 days." });
  };

  const sendEmail = async () => {
    if (!render || !leadId) return;
    setSending(true);
    try {
      const response = await fetch(`${api}/collateral/renders/${render.renderId}/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: Number(leadId), subject, bodyHtml }),
      });
      if (!response.ok) throw new Error((await response.json()).error || "Email failed");
      setEmailOpen(false);
      setLeadId("");
      toast({ title: "Collateral emailed" });
    } catch (error) {
      toast({
        title: "Email failed",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-semibold">Documents</h1>
          <p className="text-muted-foreground">Preview, download, and share personalized collateral.</p>
        </div>
        {admin && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input ref={fileRef} type="file" accept=".png,.pdf,.html,text/html,image/png,application/pdf" className="sm:w-64" />
            <Button onClick={() => void upload()}><Upload className="mr-2 h-4 w-4" />Upload template</Button>
          </div>
        )}
      </div>

      {templatesError && (
        <InlineListError
          title="Couldn’t load documents"
          status={templatesError.status}
          detail={templatesError.detail}
          onRetry={() => void loadTemplates()}
        />
      )}
      {repsError && (
        <InlineListError
          title="Couldn’t load representatives"
          status={repsError.status}
          detail={repsError.detail}
          onRetry={() => void loadReps()}
        />
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div><CardTitle className="text-lg">Campaign flyer library</CardTitle><p className="mt-1 text-sm text-muted-foreground">Find PNG and PDF flyers by category, vertical, audience, or representative.</p></div>
            <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <CampaignLibraryFlyerPicker key={flyerLibraryVersion} currentSelection={librarySelection} onSelect={(selection) => { setLibrarySelection(selection); setLibraryOpenError(""); }} />
          {librarySelection && <div className="flex flex-wrap items-center gap-3 border-t pt-4"><span className="min-w-0 flex-1 truncate text-sm font-medium">{librarySelection.name}</span><Button data-testid="button-open-library-flyer" variant="outline" disabled={libraryOpening} onClick={() => void openLibraryFlyer()}><ExternalLink className="mr-2 h-4 w-4" />{libraryOpening ? "Opening…" : "Open flyer"}</Button></div>}
          {libraryOpenError && <p role="alert" className="text-sm text-destructive">{libraryOpenError}</p>}
        </CardContent>
      </Card>

      {admin && <Card>
        <CardHeader className="border-b"><CardTitle className="text-lg">Add campaign flyers</CardTitle><p className="text-sm text-muted-foreground">Upload up to 50 PNG or PDF files. Set details for each flyer before publishing it to the library.</p></CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <Input data-testid="input-bulk-flyers" type="file" multiple accept=".png,.pdf,image/png,application/pdf" disabled={flyerUploading} onChange={(event) => { addFlyers(event.target.files); event.target.value = ""; }} aria-label="Choose campaign flyers" />
          {flyerRows.length > 0 && <>
            <div className="space-y-3">
              {flyerRows.map((row, index) => <div key={row.id} className="rounded-lg border bg-muted/20 p-3 sm:p-4" data-testid={`row-flyer-upload-${index}`}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{normalizeFlyerLabel(row.file.name)}</p><p className="text-xs text-muted-foreground">{(row.file.size / 1024 / 1024).toFixed(2)} MB · {row.file.type || "Unknown file type"}</p></div><Badge variant={row.status === "failed" ? "destructive" : "secondary"}>{row.status === "registered" ? "Added" : row.status === "uploading" ? "Uploading" : row.status === "failed" ? "Needs attention" : "Ready"}</Badge></div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <Input data-testid={`input-flyer-name-${index}`} value={row.name} disabled={flyerUploading || row.status === "registered"} onChange={(event) => updateFlyerRow(row.id, { name: event.target.value, status: "ready", error: undefined })} aria-label={`Name for ${row.file.name}`} placeholder="Flyer name" />
                  {([
                    ["category", FLYER_CATEGORIES, "Category"],
                    ["vertical", FLYER_VERTICALS, "Vertical"],
                    ["audience", FLYER_AUDIENCES, "Audience"],
                  ] as const).map(([key, options, label]) => <Select key={key} value={row[key]} disabled={flyerUploading || row.status === "registered"} onValueChange={(value) => updateFlyerRow(row.id, { [key]: value, status: "ready", error: undefined })}><SelectTrigger data-testid={`select-flyer-${key}-${index}`} aria-label={`${label} for ${row.file.name}`}><SelectValue /></SelectTrigger><SelectContent>{options.map(([value, text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select>)}
                  <div><Input data-testid={`input-flyer-rep-${index}`} type="number" min="1" step="1" list={`flyer-reps-${row.id}`} value={row.repId} disabled={flyerUploading || row.status === "registered"} onChange={(event) => updateFlyerRow(row.id, { repId: event.target.value, status: "ready", error: undefined })} aria-label={`Representative ID for ${row.file.name}`} placeholder="Rep ID (optional)" /><datalist id={`flyer-reps-${row.id}`}>{reps.map((rep) => <option key={rep.id} value={rep.id} label={normalizeFlyerLabel(rep.name || rep.email)} />)}</datalist></div>
                </div>
                {row.error && <p role="alert" className="mt-2 text-sm text-destructive">{row.file.name}: {row.error}</p>}
              </div>)}
            </div>
            <div className="flex flex-wrap items-center gap-3"><Button data-testid="button-upload-campaign-flyers" disabled={flyerUploading || flyerRows.every((row) => row.status === "registered")} onClick={() => void uploadFlyers()}><Upload className="mr-2 h-4 w-4" />{flyerUploading ? "Uploading flyers…" : flyerRows.some((row) => row.status === "failed") ? "Retry unfinished flyers" : "Upload flyers"}</Button><Button variant="outline" disabled={flyerUploading} onClick={() => setFlyerRows([])}>Clear list</Button><p className="text-xs text-muted-foreground">{flyerRows.filter((row) => row.status === "registered").length} of {flyerRows.length} added</p></div>
          </>}
        </CardContent>
      </Card>}

      {admin && reps.length > 0 && (
        <div className="max-w-sm space-y-1.5">
          <label className="text-sm font-medium">Preview version for</label>
          <Select value={repId} onValueChange={setRepId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="me">My version</SelectItem>
              {reps.map((rep) => (
                <SelectItem key={rep.id} value={String(rep.id)}>{rep.name || rep.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">Collateral library</h2>
            <p className="text-sm text-muted-foreground">Choose a document to prepare your personalized version.</p>
          </div>
          {!templatesError && templates.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No documents are available yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {templates.map((template) => (
                <Card
                  key={template.id}
                  className={cn(
                    "cursor-pointer overflow-hidden transition hover:border-primary/60 hover:shadow-sm",
                    selected?.id === template.id && "border-primary ring-2 ring-primary/15",
                  )}
                  onClick={() => setSelected(template)}
                >
                  <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
                    {template.thumbnailUrl ? (
                      <img
                        src={resolveApiUrl(template.thumbnailUrl)}
                        alt={`Preview of ${template.name}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <FileText className="h-12 w-12 text-muted-foreground/60" />
                    )}
                  </div>
                  <CardHeader className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-2 text-base">{template.name}</CardTitle>
                      <Badge variant="outline" className="shrink-0">{template.category}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {template.kind === "html" ? "HTML template" : "PDF template"} · {template.status}
                    </p>
                  </CardHeader>
                  {admin && (
                    <CardContent className="px-4 pb-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          void action(`/collateral/templates/${template.id}/${template.status === "published" ? "archive" : "publish"}`);
                        }}
                      >
                        {template.status === "published" ? <><Archive className="mr-1 h-3 w-3" />Archive</> : "Publish"}
                      </Button>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden">
            <CardHeader className="border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{selected?.name ?? "Document preview"}</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selected ? "Your personalized version" : "Select a document from the library."}
                  </p>
                </div>
                {selected && <Badge>MY VERSION</Badge>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!selected ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center">
                  <Eye className="h-10 w-10 text-muted-foreground/50" />
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Choose a document to generate and preview the version personalized for you.
                  </p>
                </div>
              ) : rendering ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Preparing your personalized document…</p>
                </div>
              ) : renderError ? (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 p-8 text-center">
                  <div>
                    <p className="font-medium">Preview unavailable</p>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">{renderError}</p>
                  </div>
                  <Button variant="outline" onClick={() => setRenderAttempt((value) => value + 1)}>
                    <RefreshCw className="mr-2 h-4 w-4" />Try again
                  </Button>
                </div>
              ) : previewUrl && render ? (
                <>
                  <iframe
                    src={`${previewUrl}#toolbar=0&navpanes=0`}
                    title={`Preview of ${selected.name}`}
                    className="h-[520px] w-full bg-muted"
                  />
                  <div className="space-y-3 border-t p-4">
                    <p className="text-sm text-muted-foreground">
                      {render.rep.name}{render.rep.title && ` · ${render.rep.title}`} · {render.rep.email}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void downloadPdf()} disabled={downloading}>
                        {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        {downloading ? "Downloading…" : "Download PDF"}
                      </Button>
                      <Button variant="outline" onClick={() => void copyLink()}>
                        <LinkIcon className="mr-2 h-4 w-4" />Copy 7-day link
                      </Button>
                      <Button variant="outline" onClick={() => setEmailOpen((open) => !open)}>
                        <Mail className="mr-2 h-4 w-4" />Email to lead
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {emailOpen && render && (
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-lg">Email collateral to a lead</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <LeadPicker
                  leads={leads}
                  value={leadId}
                  onChange={setLeadId}
                  onSearch={setLeadSearch}
                  loading={leadsLoading}
                />
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
                <textarea
                  className="min-h-32 w-full resize-y rounded-md border bg-background p-3 text-sm"
                  value={bodyHtml}
                  onChange={(event) => setBodyHtml(event.target.value)}
                  aria-label="Email message"
                />
                <div className="flex gap-2">
                  <Button onClick={() => void sendEmail()} disabled={!leadId || sending}>
                    {sending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : "Send with PDF"}
                  </Button>
                  <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}