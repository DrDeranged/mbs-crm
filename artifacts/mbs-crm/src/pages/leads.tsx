import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useListLeads, getListLeadsQueryKey, ListLeadsSortOrder, useListUsers,
  useImportLeads, usePreviewImport,
  useGetMe,
  useBulkUpdateLeadStatus,
  useBulkAssignLeads,
  useBulkDeleteLeads,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Plus, Filter, Upload, ChevronRight, Check, AlertCircle, Download, Trash2, X, Users, Building2 as BuildingIcon } from "lucide-react";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

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
  industry: "industry",
  state: "state",
};

type ImportStep = "idle" | "upload" | "preview" | "mapping" | "confirm" | "results";

interface ImportResults { imported: number; skipped: number; duplicates: { row: number; reason: string }[] }

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
              <span className={step === s ? "text-[#1F4E79] font-semibold" : ""}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
            </span>
          ))}
        </div>

        {/* Upload step */}
        {(step === "upload" || step === "preview") && (
          <div className="space-y-4">
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:border-[#1F4E79] transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-sm">Click to select a CSV or Excel file</p>
              <p className="text-xs text-muted-foreground mt-1">Supported: .csv, .xlsx, .xls — max 20 MB</p>
              {selectedFile && <p className="mt-2 text-sm font-medium text-[#1F4E79]">{selectedFile.name}</p>}
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
                          <SelectContent>
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
              <Button onClick={handleConfirm} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">Continue</Button>
            </div>
          </div>
        )}

        {/* Confirm step */}
        {step === "confirm" && preview && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 bg-gray-50 space-y-2">
              <p className="text-sm font-medium">Ready to import {preview.totalRows} leads</p>
              <p className="text-xs text-muted-foreground">Column mapping configured for {Object.values(mapping).filter((v) => v !== "__skip__").length} fields</p>
              <p className="text-xs text-muted-foreground">Duplicate leads (by email, phone, or EIN) will be skipped automatically</p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("mapping")}>Back</Button>
              <Button onClick={handleImport} disabled={importMutation.isPending} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                {importMutation.isPending ? "Importing…" : "Import Leads"}
              </Button>
            </div>
          </div>
        )}

        {/* Results step */}
        {step === "results" && results && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-4 text-center bg-green-50">
                <Check className="h-6 w-6 text-green-600 mx-auto mb-1" />
                <div className="text-2xl font-bold text-green-700">{results.imported}</div>
                <div className="text-xs text-green-600">Leads imported</div>
              </div>
              <div className="rounded-lg border p-4 text-center bg-amber-50">
                <AlertCircle className="h-6 w-6 text-amber-500 mx-auto mb-1" />
                <div className="text-2xl font-bold text-amber-600">{results.skipped}</div>
                <div className="text-xs text-amber-500">Rows skipped</div>
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
            <Button className="w-full bg-[#1F4E79] hover:bg-[#163a5f] text-white" onClick={handleClose}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Leads() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [applicationType, setApplicationType] = useState<string>("");
  const [repId, setRepId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [page, setPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<ListLeadsSortOrder>(ListLeadsSortOrder.desc);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkRepId, setBulkRepId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<"high" | "medium" | "low" | "">("");
  const [renewalFlagged, setRenewalFlagged] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => { if ((e as CustomEvent).type === "open-import-dialog") setImportOpen(true); };
    window.addEventListener("open-import-dialog", handler);
    return () => window.removeEventListener("open-import-dialog", handler);
  }, []);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: currentUser } = useGetMe();
  const isManagerOrAdmin = currentUser?.role === "manager" || currentUser?.role === "admin";
  const isAdmin = currentUser?.role === "admin";

  const bulkUpdateStatus = useBulkUpdateLeadStatus();
  const bulkAssign = useBulkAssignLeads();
  const bulkDelete = useBulkDeleteLeads();

  const toggleSelect = (id: number) => {
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
    if (!bulkRepId || selectedIds.size === 0) return;
    bulkAssign.mutate(
      { data: { ids: [...selectedIds], repId: Number(bulkRepId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          setSelectedIds(new Set()); setBulkRepId("");
          toast({ title: `Reassigned ${selectedIds.size} lead${selectedIds.size > 1 ? "s" : ""}` });
        },
        onError: () => toast({ title: "Failed to reassign leads", variant: "destructive" }),
      },
    );
  };

  const handleExport = async (ids?: number[]) => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (status) params.set("status", status);
      if (applicationType) params.set("applicationType", applicationType);
      if (repId) params.set("repId", repId);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (ids && ids.length > 0) params.set("ids", ids.join(","));
      const qs = params.toString();
      const response = await fetch(`/api/leads/export${qs ? `?${qs}` : ""}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `leads-${Date.now()}.csv`; a.click();
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

  const queryParams = {
    search: debouncedSearch || undefined,
    status: status || undefined,
    applicationType: applicationType || undefined,
    repId: repId ? Number(repId) : undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    page,
    limit: 20,
    sortBy: "updatedAt",
    sortOrder,
    ...scoreMinMax,
    ...(renewalFlagged ? { renewalFlagged: true } : {}),
  };

  const { data, isLoading } = useListLeads(queryParams, {
    query: { queryKey: getListLeadsQueryKey(queryParams) },
  });

  const { data: usersData } = useListUsers({ role: "rep" });

  const handleStatusChange = (val: string) => { setStatus(val === "all" ? "" : val); setPage(1); };
  const handleAppTypeChange = (val: string) => { setApplicationType(val === "all" ? "" : val); setPage(1); };
  const handleRepChange = (val: string) => { setRepId(val === "all" ? "" : val); setPage(1); };

  const formatStatus = (status: string) =>
    status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  const hasFilters = !!(search || status || applicationType || repId || startDate || endDate || scoreFilter || renewalFlagged);

  const clearFilters = () => {
    setSearch(""); setDebouncedSearch(""); setStatus(""); setApplicationType("");
    setRepId(""); setStartDate(""); setEndDate(""); setScoreFilter("");
    setRenewalFlagged(false); setPage(1);
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Leads</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Manage and track your financing pipeline</p>
        </div>
        <div className="flex items-center gap-3">
          {isManagerOrAdmin && (
            <>
              <Button variant="outline" onClick={() => handleExport()} disabled={isExporting}>
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? "Exporting…" : "Export All"}
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
            </>
          )}
          <Link
            href="/leads/new"
            className="inline-flex h-9 items-center justify-center rounded-md bg-[#1F4E79] px-4 py-2 text-sm font-medium text-white shadow transition-colors hover:bg-[#163a5f]"
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

      <div className="flex flex-col sm:flex-row gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search by name, email, company…"
            className="pl-9 w-full bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={status || "all"} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-full sm:w-[180px] bg-white">
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
          <SelectTrigger className="w-full sm:w-[180px] bg-white">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="working_capital">Working Capital</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
          </SelectContent>
        </Select>

        {usersData && usersData.length > 0 && (
          <Select value={repId || "all"} onValueChange={handleRepChange}>
            <SelectTrigger className="w-full sm:w-[160px] bg-white">
              <SelectValue placeholder="Rep" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {usersData.map((rep) => (
                <SelectItem key={rep.id} value={String(rep.id)}>
                  {rep.name || rep.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as ListLeadsSortOrder)}>
          <SelectTrigger className="w-full sm:w-[140px] bg-white">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ListLeadsSortOrder.desc}>Newest First</SelectItem>
            <SelectItem value={ListLeadsSortOrder.asc}>Oldest First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap items-center">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Date range:</span>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="w-[160px] bg-white text-sm"
            placeholder="From"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="w-[160px] bg-white text-sm"
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

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Score:</span>
        {(["", "high", "medium", "low"] as const).map((f) => {
          const label = f === "" ? "All" : f === "high" ? "High 70+" : f === "medium" ? "Medium 40–69" : "Low <40";
          const active = scoreFilter === f;
          const color = f === "high" ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-50" : f === "medium" ? "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-50" : f === "low" ? "bg-red-100 text-red-700 border-red-200 hover:bg-red-50" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50";
          return (
            <button
              key={f}
              onClick={() => { setScoreFilter(f); setPage(1); }}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                color,
                active && "ring-2 ring-offset-1 ring-[#1F4E79] font-semibold",
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
              ? "bg-[#1F4E79] text-white border-[#1F4E79]"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
          )}
        >
          Renewals
        </button>
      </div>

      {/* Mobile lead cards — visible below md breakpoint */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-white shadow-sm p-4 space-y-2">
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
        ) : data?.leads.length === 0 ? (
          <div className="py-10">
            {hasFilters ? (
              <Empty>
                <EmptyMedia variant="icon"><Search className="h-5 w-5" /></EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No leads match</EmptyTitle>
                  <EmptyDescription>Try adjusting your filters to find what you're looking for.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <button onClick={clearFilters} className="text-sm text-[#1F4E79] underline underline-offset-4 hover:opacity-80">Clear all filters</button>
                </EmptyContent>
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
                    <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-[#1F4E79] px-4 text-sm font-medium text-white shadow hover:bg-[#163a5f]">
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
            <Link key={lead.id} href={`/leads/${lead.id}`} className="block">
              <div className={`rounded-lg border bg-white shadow-sm p-4 space-y-2 transition-colors hover:bg-gray-50/60 ${selectedIds.has(lead.id) ? "border-blue-300 bg-blue-50/40" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{lead.firstName} {lead.lastName}</div>
                    <div className="text-xs text-muted-foreground truncate">{lead.email}</div>
                  </div>
                  <Badge variant="secondary" className="font-normal capitalize text-xs flex-shrink-0">
                    {formatStatus(lead.status)}
                  </Badge>
                </div>
                {lead.companyName && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BuildingIcon size={12} />
                    <span className="truncate">{lead.companyName}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5">
                  <span className="truncate">{lead.assignedRep ? (lead.assignedRep.name || lead.assignedRep.email) : <span className="italic">Unassigned</span>}</span>
                  <span className="flex-shrink-0 ml-2">{format(new Date(lead.updatedAt), "MMM d, yyyy")}</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Desktop table — hidden below md */}
      <div className="hidden md:block rounded-md border bg-white shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {isManagerOrAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      !!data?.leads?.length &&
                      data.leads.every((l) => selectedIds.has(l.id))
                    }
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Lead</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Assigned Rep</TableHead>
              <TableHead>Last Activity</TableHead>
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
                  <TableCell><Skeleton className="h-6 w-[100px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-[48px] rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                </TableRow>
              ))
            ) : data?.leads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isManagerOrAdmin ? 9 : 8} className="py-0">
                  {hasFilters ? (
                    <Empty className="py-12 border-0">
                      <EmptyMedia variant="icon"><Search className="h-5 w-5" /></EmptyMedia>
                      <EmptyHeader>
                        <EmptyTitle>No leads match</EmptyTitle>
                        <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
                      </EmptyHeader>
                      <EmptyContent>
                        <button onClick={clearFilters} className="text-sm text-[#1F4E79] underline underline-offset-4 hover:opacity-80">Clear all filters</button>
                      </EmptyContent>
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
                          <Link href="/leads/new" className="inline-flex h-9 items-center justify-center rounded-md bg-[#1F4E79] px-4 text-sm font-medium text-white shadow hover:bg-[#163a5f]">
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
                  className={`cursor-pointer hover:bg-gray-50/50 transition-colors ${selectedIds.has(lead.id) ? "bg-blue-50/40" : ""}`}
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
                      {lead.firstName} {lead.lastName}
                      <div className="text-xs text-muted-foreground font-normal">{lead.email}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {lead.companyName || "-"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      <Badge variant="secondary" className="font-normal capitalize">
                        {formatStatus(lead.status)}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {(lead as any).leadScore !== null && (lead as any).leadScore !== undefined ? (
                        <span className={cn(
                          "inline-flex items-center justify-center min-w-[40px] px-2 py-0.5 rounded-full text-xs font-semibold",
                          (lead as any).leadScore >= 70 ? "bg-green-100 text-green-700" :
                          (lead as any).leadScore >= 40 ? "bg-amber-100 text-amber-700" :
                          "bg-red-100 text-red-700",
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
                  <TableCell className="text-sm text-muted-foreground">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {lead.assignedRep ? (lead.assignedRep.name || lead.assignedRep.email) : <span className="italic text-xs">Unassigned</span>}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Link href={`/leads/${lead.id}`} className="block w-full">
                      {lead.lastActivityAt ? format(new Date(lead.lastActivityAt), "MMM d, yyyy") : "-"}
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

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, data.total)} of {data.total} entries
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page === data.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white border border-gray-200 shadow-xl rounded-xl px-5 py-3">
          <span className="text-sm font-semibold text-[#1F4E79] whitespace-nowrap">
            {selectedIds.size} selected
          </span>

          <div className="h-4 w-px bg-gray-200" />

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
            className="h-8 bg-[#1F4E79] hover:bg-[#163a5f] text-white text-xs"
            disabled={!bulkStatus || bulkUpdateStatus.isPending}
            onClick={handleBulkStatus}
          >
            Apply
          </Button>

          <div className="h-4 w-px bg-gray-200" />

          {usersData && usersData.length > 0 && (
            <>
              <Select value={bulkRepId} onValueChange={setBulkRepId}>
                <SelectTrigger className="h-8 w-[150px] text-xs">
                  <SelectValue placeholder="Assign To…" />
                </SelectTrigger>
                <SelectContent>
                  {usersData.map((rep) => (
                    <SelectItem key={rep.id} value={String(rep.id)}>
                      {rep.name || rep.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 bg-[#1F4E79] hover:bg-[#163a5f] text-white text-xs"
                disabled={!bulkRepId || bulkAssign.isPending}
                onClick={handleBulkAssign}
              >
                Assign
              </Button>
              <div className="h-4 w-px bg-gray-200" />
            </>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={isExporting}
            onClick={() => handleExport([...selectedIds])}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export Selected
          </Button>

          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
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
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      )}

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
