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