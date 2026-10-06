import { useState, useEffect, useRef } from "react";
import { useAssignmentDirectory as useListUsers } from "@/hooks/use-assignment-directory";
import "./leads-fit.css";
import { useIsDesktop } from "@/hooks/use-desktop-sidebar";
import { useLeadsFit } from "@/hooks/use-leads-fit";
import { LeadsFitTable } from "@/components/leads-fit-table";
import { LEADS_MOBILE_PAGE_SIZE, clampPage, pageRange, remapPage } from "@/lib/leadsPageSizing";
import { Link, useLocation } from "wouter";
import {
  useListLeads, getListLeadsQueryKey, ListLeadsSortOrder, getListUsersQueryKey,
  useImportLeads, usePreviewImport,
  useGetMe,
  useBulkUpdateLeadStatus,
  useBulkAssignLeads,
  useBulkDeleteLeads,
  useGetAnalyticsSources,
  getGetAnalyticsSourcesQueryKey,
} from "@workspace/api-client-react";
import { cn, getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Filter, Upload, ChevronRight, Check, AlertCircle, Download, Trash2, X, Users, ArrowUpDown } from "lucide-react";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { QueryErrorState } from "@/components/query-error-state";
import { formatLeadIdentity } from "@/lib/recordIdentity";
import { PhoneLink, EmailLink } from "@/components/phone-link";

const LEAD_FIELDS = [
  { value: "__skip__", label: "— skip —" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "company_name", label: "Company Name" },
  { value: "ein", label: "EIN / Tax ID" },
  { value: "application_type", label: "Financing Type" },
  { value: "lead_source", label: "Lead Source" },
  { value: "vertical", label: "Vertical" },
  { value: "industry", label: "Industry" },
  { value: "state", label: "State" },
];

const AUTO_MAP: Record<string, string> = {
  first_name: "first_name", firstname: "first_name", "first name": "first_name",
  last_name: "last_name", lastname: "last_name", "last name": "last_name",
  email: "email",
  phone: "phone", phone_number: "phone", "phone number": "phone",
  company_name: "company_name", company: "company_name", "business name": "company_name",
  ein: "ein", tax_id: "ein",
  application_type: "application_type", "financing type": "application_type",
  lead_source: "lead_source", source: "lead_source",
  vertical: "vertical", business_vertical: "vertical", "industry vertical": "vertical",
  industry: "industry",
  state: "state",
};

type ImportStep = "idle" | "upload" | "preview" | "mapping" | "confirm" | "results";

interface ImportResults { imported: number; skipped: number; duplicates: { row: number; reason: string }[] }

function LastActivity({ at, actor }: { at?: string | null; actor?: { name?: string | null; email?: string } | null }) {
  if (!at) return <span>—</span>;
  return (
    <span className="flex flex-col">
      <span>{formatDistanceToNow(new Date(at), { addSuffix: true })}</span>
      <span className="text-xs text-muted-foreground">{getUserDisplayName(actor, "System")}</span>
    </span>
  );
}

function CreatedBy({ actor, source }: { actor?: { name?: string | null; email?: string } | null; source?: string }) {
  const fallback = source === "qr-card" ? "QR-card intake" : source === "website" ? "Website intake" : "System";
  return (
    <span className="flex flex-col">
      <span className="text-xs text-muted-foreground">Created by</span>
      <span className="text-xs text-muted-foreground">{getUserDisplayName(actor, fallback)}</span>
    </span>
  );
}

function ImportDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [step, setStep] = useState<ImportStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; previewRows: Record<string, string>[]; totalRows: number } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [results, setResults] = useState<ImportResults | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewMutation = usePreviewImport();
  const importMutation = useImportLeads();

  const resetDialog = () => {
    setStep("upload");
    setSelectedFile(null);
    setPreview(null);
    setMapping({});
    setResults(null);
  };

  const handleClose = () => { resetDialog(); onClose(); };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setStep("preview");
    previewMutation.mutate(
      { data: { file } },
      {
        onSuccess: (data) => {
          setPreview(data);
          const autoMapping: Record<string, string> = {};
          data.headers.forEach((h) => {
            const key = h.toLowerCase().replace(/\s+/g, "_");
            autoMapping[h] = AUTO_MAP[key] || AUTO_MAP[h.toLowerCase()] || "__skip__";
          });
          setMapping(autoMapping);
          setStep("mapping");
        },
        onError: () => {
          toast({ title: "Parse Error", description: "Could not read file. Ensure it is a valid CSV or XLSX.", variant: "destructive" });
          setStep("upload");
          setSelectedFile(null);
        },
      },
    );
  };

  const handleConfirm = () => setStep("confirm");

  const handleImport = () => {
    if (!selectedFile) return;
    const columnMapping: Record<string, string> = {};
    Object.entries(mapping).forEach(([fileCol, leadField]) => {
      if (leadField && leadField !== "__skip__") columnMapping[fileCol] = leadField;
    });
    importMutation.mutate(
      { data: { file: selectedFile, columnMapping: JSON.stringify(columnMapping) } },
      {
        onSuccess: (data) => {
          setResults(data as unknown as ImportResults);
          setStep("results");
          onSuccess();
        },
        onError: () => toast({ title: "Import Failed", description: "Could not import leads.", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Import Leads</DialogTitle>
          <DialogDescription>
            {step === "upload" && "Upload a CSV or Excel (.xlsx) file with your lead data."}
            {step === "preview" && "Reading file…"}
            {step === "mapping" && "Map your file columns to lead fields."}
            {step === "confirm" && `Ready to import ${preview?.totalRows ?? 0} rows.`}
            {step === "results" && "Import complete."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          {(["upload", "mapping", "confirm", "results"] as ImportStep[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span className={step === s ? "text-info font-semibold" : ""}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
            </span>
          ))}
        </div>

        {/* Upload step */}
        {(step === "upload" || step === "preview") && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-info transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-sm">Click to select a CSV or Excel file</p>
              <p className="text-xs text-muted-foreground mt-1">Supported: .csv, .xlsx, .xls — max 20 MB</p>
              {selectedFile && <p className="mt-2 text-sm font-medium text-info">{selectedFile.name}</p>}
            </div>
            <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} />
            {step === "preview" && previewMutation.isPending && (
              <p className="text-center text-sm text-muted-foreground animate-pulse">Parsing file…</p>
            )}
          </div>
        )}

        {/* Mapping step */}
        {step === "mapping" && preview && (
          <div className="space-y-4 max-h-[50vh] overflow-auto">
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">File Column</TableHead>
                    <TableHead>Maps To</TableHead>
                    <TableHead className="text-right text-xs">Sample</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.headers.map((h) => (
                    <TableRow key={h}>
                      <TableCell className="font-mono text-xs">{h}</TableCell>
                      <TableCell>
                        <Select value={mapping[h] ?? "__skip__"} onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent className="z-[var(--z-dialog-popover)]">
                            {LEAD_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground truncate max-w-[100px]">
                        {preview.previewRows[0]?.[h] ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">File contains {preview.totalRows} data rows. First 5 shown as samples.</p>
            <div className="rounded-md border overflow-auto max-h-36">
              <Table>
                <TableHeader><TableRow>{preview.headers.map((h) => <TableHead key={h} className="text-xs py-1">{h}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {preview.previewRows.map((row, i) => (
                    <TableRow key={i}>{preview.headers.map((h) => <TableCell key={h} className="text-xs py-1">{row[h] ?? ""}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep("upload"); setSelectedFile(null); setPreview(null); }}>Back</Button>
              <Button onClick={handleConfirm} className="bg-primary text-primary-foreground hover:bg-primary/90">Continue</Button>
            </div>
          </div>
        )}

        {/* Confirm step */}
        {step === "confirm" && preview && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted space-y-2">
              <p className="text-sm font-medium">Ready to import {preview.totalRows} leads</p>
              <p className="text-xs text-muted-foreground">Column mapping configured for {Object.values(mapping).filter((v) => v !== "__skip__").length} fields</p>
              <p className="text-xs text-muted-foreground">Duplicate leads (by email, phone, or EIN) will be skipped automatically</p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("mapping")}>Back</Button>
              <Button onClick={handleImport} disabled={importMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90">
                {importMutation.isPending ? "Importing…" : "Import Leads"}
              </Button>
            </div>
          </div>
        )}

        {/* Results step */}
        {step === "results" && results && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-4 text-center bg-success-bg">
                <Check className="h-6 w-6 text-success mx-auto mb-1" />
                <div className="text-2xl font-bold text-success">{results.imported}</div>
                <div className="text-xs text-success">Leads imported</div>
              </div>
              <div className="rounded-lg border p-4 text-center bg-warning-bg">
                <AlertCircle className="h-6 w-6 text-warning mx-auto mb-1" />
                <div className="text-2xl font-bold text-warning">{results.skipped}</div>
                <div className="text-xs text-warning">Rows skipped</div>
              </div>
            </div>
            {results.duplicates.length > 0 && (
              <div className="rounded-md border max-h-32 overflow-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="text-xs">Row</TableHead><TableHead className="text-xs">Reason</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {results.duplicates.map((d, i) => (
                      <TableRow key={i}><TableCell className="text-xs">{d.row}</TableCell><TableCell className="text-xs">{d.reason}</TableCell></TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Leads() {
  const [location] = useLocation();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [applicationType, setApplicationType] = useState<string>("");
  const [repId, setRepId] = useState<string>("");
  const [leadSource, setLeadSource] = useState("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("updatedAt");
  const [sortOrder, setSortOrder] = useState<ListLeadsSortOrder>(ListLeadsSortOrder.desc);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkRepId, setBulkRepId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<"high" | "medium" | "low" | "">("");
  const [renewalFlagged, setRenewalFlagged] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const desktop = useIsDesktop();
  const fit = useLeadsFit(desktop);
  const limit = desktop ? (fit.pageSize ?? LEADS_MOBILE_PAGE_SIZE) : LEADS_MOBILE_PAGE_SIZE;
  const limitReady = !desktop || fit.pageSize !== null;
  const prevLimitRef = useRef(limit);
  useEffect(() => {
    if (!limitReady) return;
    if (prevLimitRef.current !== limit) {
      const old = prevLimitRef.current;
      prevLimitRef.current = limit;
      setPage((p) => remapPage(p, old, limit));
    }
  }, [limit, limitReady]);

  useEffect(() => {
    const handler = () => setImportOpen(true);
    window.addEventListener("open-import-dialog", handler);
    return () => window.removeEventListener("open-import-dialog", handler);
  }, []);

  useEffect(() => {
    if (location === "/leads" && new URLSearchParams(window.location.search).get("import") === "1") {
      setImportOpen(true);
    }
  }, [location]);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: currentUser } = useGetMe();
  const isRep = currentUser?.role === "rep";
  const isManagerOrAdmin = currentUser?.role === "manager" || currentUser?.role === "admin";
  const isAdmin = currentUser?.role === "admin";
  const isStaleView = location === "/leads/stale";

  const bulkUpdateStatus = useBulkUpdateLeadStatus();
  const bulkAssign = useBulkAssignLeads();
  const bulkDelete = useBulkDeleteLeads();
  const sourcesQuery = useGetAnalyticsSources(undefined, { query: { queryKey: [...getGetAnalyticsSourcesQueryKey(), currentUser?.id, currentUser?.role], enabled: !!currentUser } });

  const toggleSelect = (id: number) => {
    setSelectAllMatching(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.leads) return;
    const allIds = data.leads.map((l) => l.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    setSelectAllMatching(false);
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const handleBulkStatus = () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    bulkUpdateStatus.mutate(
      { data: { ids: [...selectedIds], status: bulkStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          setSelectedIds(new Set()); setBulkStatus("");
          toast({ title: `Updated ${selectedIds.size} lead${selectedIds.size > 1 ? "s" : ""}` });
        },
        onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
      },
    );
  };

  const handleBulkAssign = () => {
    if (!bulkRepId || (selectedIds.size === 0 && !selectAllMatching)) return;
    const filter = {
      leadSource: leadSource || undefined,
      search: debouncedSearch || undefined,
      status: status || undefined,
      applicationType: applicationType || undefined,
      repId: repId ? Number(repId) : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      ...scoreMinMax,
      ...(renewalFlagged ? { renewalFlagged: true } : {}),
      ...((staleOnly || isStaleView) ? { stale: true } : {}),
    };
    bulkAssign.mutate(
      {
        data: selectAllMatching
          ? { filter, repId: Number(bulkRepId) }
          : { ids: [...selectedIds], repId: Number(bulkRepId) },
      },
      {
        onSuccess: (result) => {
          const count = result?.updated ?? (selectAllMatching ? data?.total ?? 0 : selectedIds.size);
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          setSelectedIds(new Set()); setSelectAllMatching(false); setBulkRepId("");
          toast({ title: `Reassigned ${count} lead${count !== 1 ? "s" : ""}` });
        },
        onError: () => toast({ title: "Failed to reassign leads", variant: "destructive" }),
      },
    );
  };

  const handleSingleAssign = (leadId: number, repId: string) => {
    bulkAssign.mutate(
      { data: { ids: [leadId], repId: Number(repId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          toast({ title: "Lead reassigned" });
        },
        onError: () => toast({ title: "Failed to reassign lead", variant: "destructive" }),
      },
    );
  };

  const handleExport = async (ids?: number[]) => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      if (leadSource) params.set("leadSource", leadSource);
      if (applicationType) params.set("applicationType", applicationType);
      if (repId) params.set("repId", repId);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (scoreMinMax.minScore !== undefined) params.set("minScore", String(scoreMinMax.minScore));
      if (scoreMinMax.maxScore !== undefined) params.set("maxScore", String(scoreMinMax.maxScore));
      if (renewalFlagged) params.set("renewalFlagged", "true");
      if (staleOnly || isStaleView) params.set("stale", "true");
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      if (ids && ids.length > 0) params.set("ids", ids.join(","));
      const qs = params.toString();
      const response = await fetch(`/api/leads/export${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const encodedFilename = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const quotedFilename = contentDisposition.match(/filename="?([^";]+)"?/i)?.[1];
      const fallbackFilename = `mbs-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      const filename = encodedFilename
        ? decodeURIComponent(encodedFilename)
        : quotedFilename || fallbackFilename;
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    bulkDelete.mutate(
      { data: { ids: [...selectedIds] } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          setSelectedIds(new Set()); setDeleteDialogOpen(false);
          toast({ title: `Deleted ${count} lead${count > 1 ? "s" : ""}` });
        },
        onError: () => toast({ title: "Failed to delete leads", variant: "destructive" }),
      },
    );
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  const scoreMinMax = scoreFilter === "high" ? { minScore: 70 } : scoreFilter === "medium" ? { minScore: 40, maxScore: 69 } : scoreFilter === "low" ? { maxScore: 39 } : {};

  useEffect(() => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, [debouncedSearch, leadSource, status, applicationType, repId, startDate, endDate, scoreFilter, renewalFlagged, staleOnly, isStaleView]);

  const queryParams = {
    leadSource: leadSource || undefined,
    search: debouncedSearch || undefined,
    status: status || undefined,
    applicationType: applicationType || undefined,
    repId: repId ? Number(repId) : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    limit,
    sortBy,
    sortOrder,
    ...scoreMinMax,
    ...(renewalFlagged ? { renewalFlagged: true } : {}),
    ...((staleOnly || isStaleView) ? { stale: true } : {}),
  };

  const { data, isLoading, error, refetch } = useListLeads(queryParams, {
    query: { queryKey: getListLeadsQueryKey(queryParams), enabled: limitReady },
  });

  const toggleActivitySort = () => {
    if (sortBy === "lastActivityAt") {
      setSortOrder((current) => current === ListLeadsSortOrder.desc ? ListLeadsSortOrder.asc : ListLeadsSortOrder.desc);
    } else {
      setSortBy("lastActivityAt");
      setSortOrder(ListLeadsSortOrder.desc);
    }
    setPage(1);
  };

  const {
    data: usersData,
    error: usersError,
    refetch: refetchUsers,
  } = useListUsers({ role: "rep", isActive: true }, {
    query: { queryKey: getListUsersQueryKey({ role: "rep", isActive: true }), enabled: isManagerOrAdmin },
  });
  useEffect(() => {
    if (data && data.totalPages >= 1 && page > data.totalPages) setPage(clampPage(page, data.totalPages));
  }, [data, page]);
  // Keep selection toolbar geometry stable while a new page-size query is pending.
  // Its "select all matching" prompt must not disappear/reappear with query data.
  const lastSelectionData = useRef<typeof data>(undefined);
  if (data) lastSelectionData.current = data;
  const selectionData = desktop ? data ?? lastSelectionData.current : data;
  const allPageSelected = !!selectionData?.leads?.length && selectionData.leads.every((lead) => selectedIds.has(lead.id));

  const handleStatusChange = (val: string) => { setStatus(val === "all" ? "" : val); setPage(1); };
  const handleAppTypeChange = (val: string) => { setApplicationType(val === "all" ? "" : val); setPage(1); };
  const handleRepChange = (val: string) => { setRepId(val === "all" ? "" : val); setPage(1); };

  const formatStatus = (status: string) =>
    status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const hasFilters = !!(search || leadSource || status || applicationType || repId || startDate || endDate || scoreFilter || renewalFlagged || staleOnly || isStaleView);

  const clearFilters = () => {
    setLeadSource("");
    setSearch(""); setDebouncedSearch(""); setStatus(""); setApplicationType("");
    setRepId(""); setStartDate(""); setEndDate(""); setScoreFilter("");
    setRenewalFlagged(false); setStaleOnly(false); setPage(1);
  };

  const bulkBar = selectedIds.size > 0 ? (
      <div className={desktop ? "flex w-full flex-wrap items-center justify-center gap-2 bg-card border border-border rounded-xl px-3 py-2" : "fixed bottom-6 left-1/2 -translate-x-1/2 z-[var(--z-popover)] flex w-[calc(100%-2rem)] max-w-2xl flex-wrap items-center justify-center gap-2 bg-card border border-border rounded-xl px-5 py-3"}>
          <span className="text-sm font-semibold text-info whitespace-nowrap">
            {selectAllMatching ? selectionData?.total ?? selectedIds.size : selectedIds.size} selected
          </span>
          {!selectAllMatching && (desktop || allPageSelected) && selectionData && selectionData.total > (desktop ? selectedIds.size : selectionData.leads.length) && (
            <Button
              size="sm"
              variant="link"
              className="h-8 px-1 text-xs text-info"
              onClick={() => setSelectAllMatching(true)}
            >
              Select all {selectionData.total} matching leads
            </Button>
          )}

          <div className="h-4 w-px bg-secondary" />

          <Select value={bulkStatus} onValueChange={(v) => { setBulkStatus(v); }}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Change Status…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new_lead">New Lead</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="follow_up">Follow Up</SelectItem>
              <SelectItem value="application_received">App Received</SelectItem>
              <SelectItem value="submitted_to_underwriting">In Underwriting</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="funded">Funded</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-8 bg-solid hover:bg-sidebar-accent text-white text-xs"
             disabled={selectAllMatching || !bulkStatus || bulkUpdateStatus.isPending}
            onClick={handleBulkStatus}
          >
            Apply
          </Button>

          <div className="h-4 w-px bg-secondary" />

          {usersData && usersData.length > 0 && (
            <>
              <SearchableSelect
                value={bulkRepId}
                onValueChange={setBulkRepId}
                placeholder="Assign To…"
                ariaLabel="Bulk assign representative"
                className="h-8 w-[150px] text-xs"
                options={usersData.map((rep) => ({
                  value: String(rep.id),
                  label: getUserDisplayName(rep),
                  detail: rep.email || undefined,
                  keywords: [rep.email, rep.name].filter(Boolean).join(" "),
                }))}
              />
              <Button
                size="sm"
                className="h-8 bg-solid hover:bg-sidebar-accent text-white text-xs"
                 disabled={!bulkRepId || bulkAssign.isPending}
                onClick={handleBulkAssign}
              >
                Assign
              </Button>
              <div className="h-4 w-px bg-secondary" />
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isExporting}
             onClick={() => handleExport(selectAllMatching ? undefined : [...selectedIds])}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export CSV
          </Button>

           {isAdmin && !selectAllMatching && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-danger/30 text-danger hover:bg-danger-bg hover:text-danger"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs text-muted-foreground"
             onClick={() => { setSelectedIds(new Set()); setSelectAllMatching(false); }}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
  ) : null;

  return (
    <div
      ref={fit.rootRef}
      data-leads-fit={desktop ? "true" : undefined}
      style={desktop && fit.rootHeight ? { height: fit.rootHeight } : undefined}
      className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8"
    >
      <div className="leads-fit-block flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{isStaleView ? "Stale Leads" : "Leads"}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {isStaleView ? "Assigned leads with no recent activity" : "Manage and track your financing pipeline"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(isRep || isManagerOrAdmin) && (
            <Button variant="outline" onClick={() => handleExport()} disabled={isExporting}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting…" : "Export CSV"}
            </Button>
          )}
          {isManagerOrAdmin && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </>
          )}
          <Link
            href="/leads/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-solid px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-sidebar-accent"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Lead
          </Link>
        </div>
      </div>
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() })}
      />

      <div className="leads-fit-block flex flex-col sm:flex-row gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name, email, company…"
            className="pl-9 w-full bg-card"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={status || "all"} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <SelectValue placeholder="Status" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new_lead">New Lead</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="follow_up">Follow Up</SelectItem>
            <SelectItem value="application_received">App Received</SelectItem>
            <SelectItem value="submitted_to_underwriting">In Underwriting</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="funded">Funded</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
          </SelectContent>
        </Select>

        <Select value={applicationType || "all"} onValueChange={handleAppTypeChange}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="working_capital">Working Capital</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
          </SelectContent>
        </Select>

        {isManagerOrAdmin && usersData && usersData.length > 0 && (
          <SearchableSelect
            value={repId || "all"}
            onValueChange={handleRepChange}
            placeholder="Rep"
            ariaLabel="Filter by representative"
            className="w-full bg-card sm:w-[160px]"
            options={[
              { value: "all", label: "All Reps" },
              ...usersData.map((rep) => ({
                value: String(rep.id),
                label: getUserDisplayName(rep),
                detail: rep.email || undefined,
                keywords: [rep.email, rep.name].filter(Boolean).join(" "),
              })),
            ]}
          />
        )}
        <SearchableSelect
          value={leadSource || "__all_sources__"}
          onValueChange={value => { setLeadSource(value === "__all_sources__" ? "" : value); setPage(1); }}
          ariaLabel="Lead Source"
          placeholder="Lead Source"
          className="w-full bg-card sm:w-[180px]"
          disabled={sourcesQuery.isPending || sourcesQuery.isError}
          options={[
            { value: "__all_sources__", label: "All Lead Sources" },
            ...(sourcesQuery.data ?? []).filter(item => item.leadCount > 0).sort((a, b) => a.source.localeCompare(b.source))
              .map(item => ({ value: item.source, label: `${item.source} (${item.leadCount.toLocaleString()})` })),
          ]}
        />
        {sourcesQuery.isError && <Button variant="outline" size="sm" onClick={() => void sourcesQuery.refetch()}>Retry lead sources</Button>}

        <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as ListLeadsSortOrder)}>
          <SelectTrigger className="w-full sm:w-[140px] bg-card">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ListLeadsSortOrder.desc}>Newest First</SelectItem>
            <SelectItem value={ListLeadsSortOrder.asc}>Oldest First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="leads-fit-block flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-center">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Date range:</span>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="w-[160px] bg-card text-sm"
            placeholder="From"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="w-[160px] bg-card text-sm"
            placeholder="To"
          />
          {(startDate || endDate) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground px-2"
              onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="leads-fit-block flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Score:</span>
        {(["", "high", "medium", "low"] as const).map((f) => {
          const label = f === "" ? "All" : f === "high" ? "High 70+" : f === "medium" ? "Medium 40–69" : "Low <40";
          const active = scoreFilter === f;
          const color = f === "high" ? "bg-success-bg text-success border-success/30 hover:bg-success-bg" : f === "medium" ? "bg-warning-bg text-warning border-warning/30 hover:bg-warning-bg" : f === "low" ? "bg-danger-bg text-danger border-danger/30 hover:bg-danger-bg" : "bg-card text-muted-foreground border-border hover:bg-muted";
          return (
            <button
              key={f}
              onClick={() => { setScoreFilter(f); setPage(1); }}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                color,
                active && "ring-2 ring-offset-1 ring-ring font-semibold",
              )}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={() => { setRenewalFlagged((v) => !v); setPage(1); }}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-all ml-2",
            renewalFlagged
              ? "bg-solid text-white border-info"
              : "bg-card text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Renewals
        </button>
        {!isStaleView && (
          <button
            onClick={() => { setStaleOnly((value) => !value); setPage(1); }}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-all ml-2",
              staleOnly
                ? "bg-danger-bg text-danger border-danger/30 ring-2 ring-offset-1 ring-ring"
                : "bg-card text-muted-foreground border-border hover:bg-muted",
            )}
          >
            Stale
          </button>
        )}
      </div>

      {isManagerOrAdmin && data?.leads?.length ? (
        <div className="md:hidden mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={allPageSelected} onCheckedChange={toggleSelectAll} aria-label="Select all leads on this page" />
          <span>Select all leads on this page</span>
        </div>
      ) : null}

      {error && (
        <div className="mb-4">
          <QueryErrorState
            label="Leads"
            error={error}
            onRetry={() => { void refetch(); }}
            testId="status-leads-error"
          />
        </div>
      )}
      {isManagerOrAdmin && usersError && (
        <div className="mb-4">
          <QueryErrorState
            label="Available representatives"
            error={usersError}
            onRetry={() => { void refetchUsers(); }}
            testId="status-lead-representatives-error"
          />
        </div>
      )}

      {/* Mobile lead cards — visible below md breakpoint */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-[140px]" />
                  <Skeleton className="h-3 w-[180px]" />
                </div>
                <Skeleton className="h-5 w-[90px] rounded-full" />
              </div>
              <Skeleton className="h-3 w-[120px]" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-[100px]" />
                <Skeleton className="h-3 w-[80px]" />
              </div>
            </div>
          ))
        ) : error && !data ? null : data?.leads.length === 0 ? (
          <div className="py-10">
            {hasFilters ? (
              <Empty>
                <EmptyMedia variant="icon"><Search className="h-5 w-5" /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No leads match</EmptyTitle>
                  <EmptyDescription>Try adjusting your filters to find what you're looking for.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <button onClick={clearFilters} className="text-sm text-info underline underline-offset-4 hover:opacity-80">Clear all filters</button>
                </EmptyContent>
              </Empty>
            ) : isRep ? (
              <Empty>
                <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No leads assigned to you yet</EmptyTitle>
                  <EmptyDescription>Leads assigned to you will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Empty>
                <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No leads yet</EmptyTitle>
                  <EmptyDescription>Add your first lead manually or import a list to get started.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <div className="flex flex-col gap-2 w-full">
                    <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-solid px-4 text-sm font-medium text-white shadow hover:bg-sidebar-accent">
                      <Plus className="mr-2 h-4 w-4" />New Lead
                    </Link>
                    {isManagerOrAdmin && (
                      <button onClick={() => setImportOpen(true)} className="inline-flex h-9 items-center justify-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent">
                        <Upload className="mr-2 h-4 w-4" />Import
                      </button>
                    )}
                  </div>
                </EmptyContent>
              </Empty>
            )}
          </div>
        ) : (
          data?.leads.map((lead) => (
            <div key={lead.id} className={`rounded-lg border bg-card p-4 space-y-2 transition-colors hover:bg-muted ${selectedIds.has(lead.id) ? "border-info/30 bg-info-bg/40" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isManagerOrAdmin && (
                        <span onClick={(event) => event.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(lead.id)}
                            onCheckedChange={() => toggleSelect(lead.id)}
                            aria-label={`Select lead ${lead.id}`}
                          />
                        </span>
                      )}
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-semibold text-sm truncate text-foreground hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {formatLeadIdentity(lead)}
                      </Link>
                    </div>
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {lead.phone?.trim() ? <PhoneLink phone={lead.phone} leadId={lead.id} className="text-xs" /> : <span>Phone unavailable</span>}
                      {lead.email?.trim() ? <EmailLink email={lead.email} leadId={lead.id} className="text-xs" /> : <span>Email unavailable</span>}
                    </div>
                    <CreatedBy actor={lead.createdBy} source={lead.leadSource} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="font-normal capitalize text-xs flex-shrink-0">
                      {formatStatus(lead.status)}
                    </Badge>
                    {lead.isStale && <Badge className="bg-danger-bg text-danger hover:bg-danger-bg text-xs">Stale</Badge>}
                    {lead.needsAssignment && (
                      <Badge variant="outline" className="border-warning/30 bg-warning-bg text-[10px] font-normal text-warning">
                        Inbound — needs assignment
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-foreground">Assigned Rep: </span>
                    {lead.assignedRep ? getUserDisplayName(lead.assignedRep) : <span className="font-semibold italic text-warning">Unassigned</span>}
                  </span>
                  <span className="flex-shrink-0 ml-2">{format(new Date(lead.updatedAt), "MMM d, yyyy")}</span>
                </div>
            </div>
          ))
        )}
      </div>

      {desktop ? (
        <>
          <div ref={fit.regionRef} className="leads-fit-region">
            <LeadsFitTable
              leads={data?.leads}
              isLoading={isLoading || !limitReady}
              unavailable={!!error && !data}
              skeletonRows={Math.min(limit, 12)}
              hasFilters={hasFilters}
              isRep={isRep}
              isManagerOrAdmin={isManagerOrAdmin}
              isStaleView={isStaleView}
              selectedIds={selectedIds}
              allPageSelected={allPageSelected}
              users={usersData}
              assignPending={bulkAssign.isPending}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onSingleAssign={handleSingleAssign}
              onToggleActivitySort={toggleActivitySort}
              onClearFilters={clearFilters}
              onImport={() => setImportOpen(true)}
            />
          </div>
          {isManagerOrAdmin && <div className="leads-fit-bulk-slot" data-testid="slot-leads-bulk">{bulkBar}</div>}
        </>
      ) : (
      <div className="hidden md:block rounded-md border bg-card overflow-x-auto">
        <Table className="leads-data-table">
          <TableHeader>
            <TableRow>
              {isManagerOrAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allPageSelected
                    }
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead className="min-w-40">Lead</TableHead>
              <TableHead className="min-w-40">Company</TableHead>
              <TableHead className="min-w-36">Phone</TableHead>
              <TableHead className="min-w-60">Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Stale</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="font-semibold text-foreground">Created by</TableHead>
              <TableHead className="font-semibold text-foreground">Assigned Rep</TableHead>
              <TableHead>
                <Button variant="ghost" size="sm" className="-ml-3 h-8 px-3 font-medium" onClick={toggleActivitySort}>
                  Last Activity <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
                </Button>
              </TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {isManagerOrAdmin && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                  <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[110px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[140px]" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[100px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[48px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                </TableRow>
              ))
            ) : error && !data ? (
              <TableRow>
                <TableCell colSpan={isManagerOrAdmin ? 13 : 12} className="py-12 text-center text-muted-foreground">
                  Lead results are unavailable.
                </TableCell>
              </TableRow>
            ) : data?.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isManagerOrAdmin ? 13 : 12} className="py-0">
                  {hasFilters ? (
                    <Empty className="py-12 border-0">
                      <EmptyMedia variant="icon"><Search className="h-5 w-5" /></EmptyMedia>
                      <EmptyHeader>
                        <EmptyTitle>No leads match</EmptyTitle>
                        <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <button onClick={clearFilters} className="text-sm text-info underline underline-offset-4 hover:opacity-80">Clear all filters</button>
                      </EmptyContent>
                    </Empty>
                  ) : isRep ? (
                    <Empty className="py-12 border-0">
                      <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
                      <EmptyHeader>
                        <EmptyTitle>No leads assigned to you yet</EmptyTitle>
                        <EmptyDescription>Leads assigned to you will appear here.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <Empty className="py-12 border-0">
                      <EmptyMedia variant="icon"><Users className="h-5 w-5" /></EmptyMedia>
                      <EmptyHeader>
                        <EmptyTitle>No leads yet</EmptyTitle>
                        <EmptyDescription>Add your first lead manually or import a list to get started.</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-solid px-4 text-sm font-medium text-white shadow hover:bg-sidebar-accent">
                            <Plus className="mr-2 h-4 w-4" />New Lead
                          </Link>
                          {isManagerOrAdmin && (
                            <button onClick={() => setImportOpen(true)} className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent">
                              <Upload className="mr-2 h-4 w-4" />Import
                            </button>
                          )}
                        </div>
                      </EmptyContent>
                    </Empty>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              data?.leads.map((lead) => (
                <TableRow
                  key={lead.id}
                  className={`cursor-pointer hover:bg-muted transition-colors ${selectedIds.has(lead.id) ? "bg-info-bg/40" : ""}`}
                >
                  {isManagerOrAdmin && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select lead ${lead.id}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {formatLeadIdentity(lead)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full text-success hover:underline">
                      {lead.companyName || "—"}
                    </Link>
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {lead.phone?.trim() ? <PhoneLink phone={lead.phone} leadId={lead.id} className="text-sm" /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {lead.email?.trim() ? <EmailLink email={lead.email} leadId={lead.id} className="text-sm" /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      <div className="flex items-center gap-1">
                        <Badge variant="secondary" className="font-normal capitalize">
                          {formatStatus(lead.status)}
                        </Badge>
                        {lead.isStale && <Badge className="bg-danger-bg text-danger hover:bg-danger-bg">Stale</Badge>}
                        {lead.needsAssignment && (
                          <Badge variant="outline" className="border-warning/30 bg-warning-bg text-[10px] font-normal text-warning">
                            Inbound — needs assignment
                          </Badge>
                        )}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {lead.isStale ? (
                        <Badge className="bg-danger-bg text-danger hover:bg-danger-bg">{lead.daysIdle}d idle</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {(lead as any).leadScore !== null && (lead as any).leadScore !== undefined ? (
                        <span className={cn(
                          "inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-full text-xs font-semibold",
                          (lead as any).leadScore >= 70 ? "bg-success-bg text-success" :
                          (lead as any).leadScore >= 40 ? "bg-warning-bg text-warning" :
                          "bg-danger-bg text-danger",
                        )}>
                          {(lead as any).leadScore}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="block w-full capitalize text-sm text-muted-foreground"
                    >
                      {lead.applicationType.replace(/_/g, " ")}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      <CreatedBy actor={lead.createdBy} source={lead.leadSource} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {isStaleView && isManagerOrAdmin ? (
                      <div onClick={(event) => event.stopPropagation()}>
                        <SearchableSelect
                          value={lead.assignedRepId ? String(lead.assignedRepId) : ""}
                          onValueChange={(repId) => handleSingleAssign(lead.id, repId)}
                          disabled={bulkAssign.isPending}
                          placeholder="Assign rep…"
                          ariaLabel={`Assign representative for lead ${lead.id}`}
                          className="h-8 w-[160px] text-xs"
                          options={(usersData ?? []).map((rep) => ({
                            value: String(rep.id),
                            label: getUserDisplayName(rep),
                            detail: rep.email || undefined,
                            keywords: [rep.email, rep.name].filter(Boolean).join(" "),
                          }))}
                        />
                      </div>
                    ) : (
                      <Link href={`/leads/${lead.id}`} className="block w-full font-semibold text-foreground">
                        <span className="sr-only">Assigned Rep: </span>
                        {lead.assignedRep ? getUserDisplayName(lead.assignedRep) : <span className="italic text-warning">Unassigned</span>}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      <LastActivity at={lead.lastActivityAt} actor={lead.lastActivityActor} />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="block w-full text-sm text-muted-foreground"
                    >
                      {format(new Date(lead.updatedAt), "MMM d, yyyy")}
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      )}

      {(desktop || (data && data.totalPages > 1)) && (
        <div className={desktop ? "leads-fit-footer" : "flex items-center justify-between mt-4"} data-testid="pagination-leads">
          <div className="text-sm text-muted-foreground">
            {data ? (() => { const r = pageRange(page, limit, data.total); return `Showing ${r.start} to ${r.end} of ${data.total} entries`; })() : error ? "Lead results unavailable" : "Loading leads…"}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!data || isLoading || page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data?.totalPages ?? 1, p + 1))}
              disabled={!data || isLoading || page >= data.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {!desktop && bulkBar}

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} lead{selectedIds.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. All data associated with the selected lead{selectedIds.size > 1 ? "s" : ""} — including notes, tasks, documents, and activity — will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
