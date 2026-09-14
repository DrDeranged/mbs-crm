import { useRef, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { File as FileIcon, FileDown, Download, Loader2, UploadCloud } from "lucide-react";
import { getListDocumentsQueryKey, getListLeadActivityQueryKey, useGetLeadApplication, useListDocuments, useUploadDocument, downloadDocument } from "@workspace/api-client-react";
import { getLenderPackageFilename } from "@/lib/lenderPackageDownload";
import { useLeadDetail } from "./context";
const apiBase = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;
// Documents Tab
export function LeadDocuments() {
  const { id: leadId } = useLeadDetail();
  const { data: documents, isLoading } = useListDocuments(leadId, { query: { queryKey: getListDocumentsQueryKey(leadId) } });
  const { data: application, isLoading: applicationLoading } = useGetLeadApplication(leadId);
  const uploadDocument = useUploadDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const packageDownloadInFlight = useRef(false);
  const [isGeneratingPackage, setIsGeneratingPackage] = useState(false);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadDocument.mutate(
      { id: leadId, data: { file } },
      {
        onSuccess: () => {
          toast({ title: "Document Uploaded" });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey(leadId) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(leadId) });
        },
        onError: () => toast({ title: "Error", description: "Failed to upload document", variant: "destructive" }),
        onSettled: () => { if (e.target) e.target.value = ""; },
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
    try {
      const response = await fetch(`${apiBase}/leads/${leadId}/lender-package`, {
        method: "GET",
        headers: { Accept: "application/pdf" },
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);

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
        title: "Lender package failed",
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
      onClick={handleLenderPackageDownload}
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
          <div className="relative">
            <Input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleUpload}
              disabled={uploadDocument.isPending}
            />
            <Button size="sm" variant="outline" disabled={uploadDocument.isPending}>
              {uploadDocument.isPending ? "Uploading..." : <><UploadCloud className="w-4 h-4 mr-2" /> Upload</>}
            </Button>
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

