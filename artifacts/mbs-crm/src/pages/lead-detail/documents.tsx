import { useRef, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
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
  useGetLeadApplication,
  useGetMe,
  useListDocuments,
  useUpdateDocumentCategory,
  useUploadDocument,
  downloadDocument,
} from "@workspace/api-client-react";
import { getLenderPackageFilename } from "@/lib/lenderPackageDownload";
import { useLeadDetail } from "./context";
import { lenderPackageFailureTitle } from "@/lib/lenderPackageError";
import { LenderPackageBuilderDialog } from "./lender-package-builder";
const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

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
  const { id: leadId } = useLeadDetail();
  const { data: me } = useGetMe();
  const { data: documents, isLoading } = useListDocuments(leadId, { query: { queryKey: getListDocumentsQueryKey(leadId) } });
  const { data: application, isLoading: applicationLoading } = useGetLeadApplication(leadId);
  const uploadDocument = useUploadDocument();
  const updateDocumentCategory = useUpdateDocumentCategory();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const packageDownloadInFlight = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isGeneratingPackage, setIsGeneratingPackage] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>("other");
  const [packageBuilderOpen, setPackageBuilderOpen] = useState(false);

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

  const handleDownload = async (docId: number, _filename: string) => {
    try {
      const result = await downloadDocument(docId);
      if (result.downloadUrl) window.open(result.downloadUrl, "_blank");
    } catch {
      toast({ title: "Download Error", description: "Could not download document.", variant: "destructive" });
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
        <div className="flex flex-wrap items-center justify-end gap-2">
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
          <div className="flex items-center gap-2">
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

