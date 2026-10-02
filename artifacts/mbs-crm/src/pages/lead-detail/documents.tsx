import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { File as FileIcon, FileDown, Download, Loader2, UploadCloud } from "lucide-react";
import {
  type DocumentCategory,
  getListDocumentsQueryKey,
  getListLeadActivityQueryKey,
  getListTasksQueryKey,
  useGetLeadApplication,
  useGetMe,
  useListDocuments,
  useListTasks,
  useUpdateDocumentCategory,
  useUploadDocument,
} from "@workspace/api-client-react";
import { getLenderPackageFilename } from "@/lib/lenderPackageDownload";
import { fetchAuthenticatedBlob, safeDownloadFilename, saveBlob } from "@/lib/fileDownload";
import { useLeadDetail, useLeadDetailAction } from "./context";
import { lenderPackageFailureTitle } from "@/lib/lenderPackageError";
import { LenderPackageBuilderDialog } from "./lender-package-builder";
const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
const usfaStatementSlots = ["A", "B", "C", "D"] as const;
type UsfaStatementLink = { slot?: typeof usfaStatementSlots[number]; url: string };

function safeUsfaHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "usfundadvisor.ai" && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

const documentCategoryOptions: Array<{ value: DocumentCategory; label: string }> = [
  { value: "bank_statement", label: "Bank statement" },
  { value: "invoice_quote", label: "Invoice / quote" },
  { value: "drivers_license", label: "Driver's license" },
  { value: "tax_return", label: "Tax return" },
  { value: "signed_application", label: "Signed application" },
  { value: "other", label: "Other" },
];

function inferDocumentCategory(filename: string): DocumentCategory {
  return /bank|statement/i.test(filename) ? "bank_statement" : "other";
}

// Documents Tab
export function LeadDocuments() {
  const { id: leadId, lead } = useLeadDetail();
  const { data: me } = useGetMe();
  const { data: documents, isLoading } = useListDocuments(leadId, { query: { queryKey: getListDocumentsQueryKey(leadId) } });
  const taskQuery = useListTasks(leadId, { query: { queryKey: getListTasksQueryKey(leadId) } });
  const { data: application, isLoading: applicationLoading } = useGetLeadApplication(leadId);
  const uploadDocument = useUploadDocument();
  const updateDocumentCategory = useUpdateDocumentCategory();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const packageDownloadInFlight = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), []);
  const [isGeneratingPackage, setIsGeneratingPackage] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("other");
  const [packageBuilderOpen, setPackageBuilderOpen] = useState(false);
  const [isUploadingStatements, setIsUploadingStatements] = useState(false);
  const [statementLinks, setStatementLinks] = useState<UsfaStatementLink[]>([]);
  const [statementLinksLoading, setStatementLinksLoading] = useState(false);
  const [statementLinksError, setStatementLinksError] = useState("");
  const isUsfaLead = lead?.leadSource === "usfundadvisor";
  useLeadDetailAction("upload", openFilePicker);

  useEffect(() => {
    if (!isUsfaLead) {
      setStatementLinks([]);
      setStatementLinksError("");
      return;
    }

    const controller = new AbortController();
    setStatementLinks([]);
    setStatementLinksLoading(true);
    setStatementLinksError("");
    fetch(`${apiBase}/leads/${leadId}/usfa-statements`, {
      credentials: "include",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const result = await response.json() as { links?: UsfaStatementLink[]; storedLinkCount?: number };
        setStatementLinks(Array.isArray(result.links) ? result.links : []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatementLinksError(error instanceof Error ? error.message : "Could not load USFA statements.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setStatementLinksLoading(false);
      });

    return () => controller.abort();
  }, [isUsfaLead, leadId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadCategory(inferDocumentCategory(file.name));
  };

  const handleUpload = () => {
    if (!selectedFile) return;
    uploadDocument.mutate(
      { id: leadId, data: { file: selectedFile, category: uploadCategory } },
      {
        onSuccess: () => {
          toast({ title: "Document Uploaded" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        onError: () => toast({ title: "Error", description: "Failed to upload document", variant: "destructive" }),
      },
    );
  };

  const handleCategoryChange = (docId: number, category: DocumentCategory) => {
    updateDocumentCategory.mutate(
      { docId, data: { category } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
        },
        onError: () => toast({ title: "Error", description: "Failed to update document category", variant: "destructive" }),
      },
    );
  };

  const handleStatementDrop = useCallback(async (files: File[]) => {
    if (!files.length || isUploadingStatements || uploadDocument.isPending) return;
    setIsUploadingStatements(true);
    let uploadedCount = 0;
    try {
      for (const file of files) {
        await uploadDocument.mutateAsync({ id: leadId, data: { file, category: "bank_statement" } });
        uploadedCount += 1;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) }),
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) }),
        queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) }),
      ]);
      const latestDocuments = queryClient.getQueryData<NonNullable<typeof documents>>(getListDocumentsQueryKey(leadId)) ?? documents ?? [];
      const totalBankStatements = latestDocuments.filter((document) => document.category === "bank_statement").length;
      const refreshedTasks = queryClient.getQueryData<NonNullable<typeof taskQuery.data>>(getListTasksQueryKey(leadId)) ?? [];
      const statementTask = refreshedTasks.find((task) => /bank statement/i.test(task.title));
      const autoCompletionDescription = statementTask?.isCompleted
        ? "The bank-statement task is complete."
        : totalBankStatements >= 3
          ? "Three or more bank statements are on file; the task is not yet marked complete."
          : `${totalBankStatements} of 3 bank statements are on file; the auto-completion threshold has not been reached.`;
      toast({
        title: `${uploadedCount} bank statement${uploadedCount === 1 ? "" : "s"} uploaded`,
        description: autoCompletionDescription,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "An upload failed.";
      toast({
        title: uploadedCount ? `${uploadedCount} of ${files.length} statements uploaded` : "Statement upload failed",
        description: `${reason}${uploadedCount ? " Remaining files were not uploaded." : ""}`,
        variant: "destructive",
      });
      if (uploadedCount) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) }),
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(leadId) }),
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) }),
        ]);
      }
    } finally {
      setIsUploadingStatements(false);
    }
  }, [documents, isUploadingStatements, leadId, queryClient, toast, uploadDocument]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => { void handleStatementDrop(files); },
    multiple: true,
    disabled: isUploadingStatements || uploadDocument.isPending,
  });

  const handleDownload = async (docId: number, filename: string) => {
    try {
      const blob = await fetchAuthenticatedBlob(`${apiBase}/documents/${docId}/download?direct=true`);
      saveBlob(blob, safeDownloadFilename(filename, `document-${docId}`));
    } catch (error) {
      toast({
        title: "Download Error",
        description: error instanceof Error ? error.message : "Could not download document.",
        variant: "destructive",
      });
    }
  };

  const handleLenderPackageDownload = async () => {
    if (!application?.submittedAt || packageDownloadInFlight.current) return;

    packageDownloadInFlight.current = true;
    setIsGeneratingPackage(true);
    let failureReason: unknown;
    try {
      const response = await fetch(`${apiBase}/leads/${leadId}/lender-package`, {
        method: "GET",
        headers: { Accept: "application/pdf" },
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        failureReason = body?.reason;
        throw new Error(`Request failed (${response.status})`);
      }

      const blob = await response.blob();
      if (!blob.size) throw new Error("The lender package was empty");

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = getLenderPackageFilename(
        response.headers.get("Content-Disposition"),
        `MBS-Application-${leadId}.pdf`,
      );
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: lenderPackageFailureTitle(me?.role, failureReason),
        description: "Could not generate the lender package. Please try again.",
        variant: "destructive",
      });
    } finally {
      packageDownloadInFlight.current = false;
      setIsGeneratingPackage(false);
    }
  };

  const lenderPackageButton = (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0"
      data-testid="button-lender-package"
      onClick={() => setPackageBuilderOpen(true)}
      disabled={applicationLoading || !application?.submittedAt || isGeneratingPackage}
      aria-label="Download Lender Package PDF"
    >
      {isGeneratingPackage ? (
        <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
      ) : (
        <><FileDown className="h-4 w-4" /> Lender Package (PDF)</>
      )}
    </Button>
  );

  return (
    <div className="space-y-6 mt-4">
      <LenderPackageBuilderDialog leadId={leadId} open={packageBuilderOpen} onOpenChange={setPackageBuilderOpen} />
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h3 className="font-medium">Documents</h3>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
          {!applicationLoading && !application?.submittedAt ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  title="No application on file"
                  data-testid="tooltip-lender-package-unavailable"
                >
                  {lenderPackageButton}
                </span>
              </TooltipTrigger>
              <TooltipContent>No application on file</TooltipContent>
            </Tooltip>
          ) : (
            lenderPackageButton
          )}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="relative">
            <Input
              ref={fileInputRef}
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileChange}
              disabled={uploadDocument.isPending}
            />
              <Button size="sm" variant="outline" disabled={uploadDocument.isPending}>
                Choose file
              </Button>
            </div>
            <Select
              value={uploadCategory}
              onValueChange={(value) => setUploadCategory(value as DocumentCategory)}
            >
              <SelectTrigger aria-label="Document category" className="h-9 w-[170px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {documentCategoryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={!selectedFile || uploadDocument.isPending}
            >
              {uploadDocument.isPending ? "Uploading..." : <><UploadCloud className="w-4 h-4 mr-2" /> Upload</>}
            </Button>
            {selectedFile && <span className="max-w-36 truncate text-xs text-muted-foreground" title={selectedFile.name}>{selectedFile.name}</span>}
          </div>
        </div>
      </div>

      {isUsfaLead && (
        <section className="space-y-3 rounded-md border bg-white p-4 shadow-sm" aria-label="USFA statements">
          <div>
            <h4 className="font-medium">USFA statements</h4>
            <p className="text-sm text-muted-foreground">Statements stored from the USFA dashboard.</p>
          </div>
          {statementLinksLoading ? (
            <div className="space-y-2" aria-label="Loading USFA statements">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-40" />
            </div>
          ) : statementLinksError ? (
            <p role="alert" className="text-sm text-destructive">Could not load USFA statements: {statementLinksError}</p>
          ) : statementLinks.length ? (
            <div className="flex flex-wrap gap-2">
              {usfaStatementSlots.map((slot) => {
                const statement = statementLinks.find((link) => link.slot === slot);
                if (!statement) return null;
                const safeHref = safeUsfaHref(statement.url);
                return safeHref ? (
                  <Button key={slot} asChild size="sm" variant="outline" data-testid={`link-usfa-statement-${slot.toLowerCase()}`}>
                    <a href={safeHref} target="_blank" rel="noopener noreferrer">
                      Statement {slot} — Open in USFA dashboard
                    </a>
                  </Button>
                ) : null;
              })}
              {statementLinks.filter((statement) => !statement.slot).map((statement, index) => {
                const safeHref = safeUsfaHref(statement.url);
                return safeHref ? (
                  <Button key={`unlabeled-${index}`} asChild size="sm" variant="outline"
                    data-testid={`link-usfa-statement-unlabeled-${index + 1}`}>
                    <a href={safeHref} target="_blank" rel="noopener noreferrer">
                      Statement link {index + 1} — Open in USFA dashboard
                    </a>
                  </Button>
                ) : null;
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No USFA statements are currently linked.</p>
          )}
          <div
            {...getRootProps({
              className: `cursor-pointer rounded-md border border-dashed p-5 text-center text-sm transition-colors ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:bg-muted/30"} ${isUploadingStatements ? "cursor-wait opacity-60" : ""}`,
              "data-testid": "dropzone-usfa-statements",
            })}
          >
            <input {...getInputProps()} data-testid="input-usfa-statements" />
            <UploadCloud className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            {isUploadingStatements
              ? "Uploading statements…"
              : isDragActive
                ? "Drop bank statements here"
                : "Drag and drop multiple bank statements here, or click to select files"}
          </div>
        </section>
      )}

      <div className="rounded-md border bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : documents?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-gray-50/50">No documents found.</div>
        ) : (
          <div className="divide-y">
            {documents?.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between p-4 hover:bg-gray-50/50 min-w-0 gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                    <FileIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" title={doc.filename}>{doc.filename}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(doc.fileSize / 1024).toFixed(1)} KB • {format(new Date(doc.createdAt), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <Select
                  value={doc.category}
                  onValueChange={(value) => handleCategoryChange(doc.id, value as DocumentCategory)}
                  disabled={updateDocumentCategory.isPending}
                >
                  <SelectTrigger
                    aria-label={`Category for ${doc.filename}`}
                    className="h-7 w-[145px] rounded-full border-blue-200 bg-blue-50 px-2 text-xs text-blue-700"
                    data-testid={`document-category-${doc.id}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {documentCategoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => handleDownload(doc.id, doc.filename)}>
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

