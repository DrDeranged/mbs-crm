import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, FileDown, Loader2, ClipboardList, Copy, ShieldCheck, TrendingUp, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetLeadApplication } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
export function LeadApplication() {
  const { id: leadId } = useLeadDetail();
  const { data, isLoading, error } = useGetLeadApplication(leadId);
  const { toast } = useToast();

  const applyUrl = `${window.location.origin}${import.meta.env.BASE_URL}apply`;

  const copyLink = () => {
    navigator.clipboard.writeText(applyUrl).then(() => {
      toast({ title: "Link copied!", description: "Application link copied to clipboard." });
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#1F4E79]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6 space-y-3">
              <ClipboardList className="h-10 w-10 text-gray-300 mx-auto" />
              <p className="text-gray-500 font-medium">No application on file</p>
              <p className="text-sm text-gray-400">Share the application link so the lead can submit their information.</p>
              <div className="flex items-center justify-center gap-2 mt-4">
                <code className="text-xs bg-slate-100 px-3 py-2 rounded-lg text-[#1F4E79] font-mono break-all">{applyUrl}</code>
                <Button variant="outline" size="sm" onClick={copyLink} className="flex items-center gap-1.5 flex-shrink-0">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const app = data;
  const fmt = (v: number | null | undefined, prefix = "$") =>
    v != null ? `${prefix}${v.toLocaleString()}` : "—";

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-[#1F4E79]/10 flex items-center justify-center">
            <ClipboardList className="h-4 w-4 text-[#1F4E79]" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">Application on File</p>
            <p className="text-xs text-gray-400">Submitted {app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : "—"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize bg-blue-50 border-blue-200 text-blue-700">
            {app.type.replace("_", " ")}
          </Badge>
          {app.signedDocumentUrl && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 text-xs h-7"
              onClick={() => window.open(app.signedDocumentUrl!, "_blank")}
            >
              <FileDown className="h-3.5 w-3.5" /> Download
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Business Info */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Business Name</dt><dd className="font-medium">{app.businessName}</dd></div>
              {app.dba && <div className="flex justify-between"><dt className="text-gray-500">DBA</dt><dd className="font-medium">{app.dba}</dd></div>}
              {app.ein && <div className="flex justify-between"><dt className="text-gray-500">EIN</dt><dd className="font-medium">{app.ein}</dd></div>}
              {app.industry && <div className="flex justify-between"><dt className="text-gray-500">Industry</dt><dd className="font-medium">{app.industry}</dd></div>}
              {app.timeInBusinessMonths != null && <div className="flex justify-between"><dt className="text-gray-500">Time in Business</dt><dd className="font-medium">{Math.round(app.timeInBusinessMonths / 12)} yr(s)</dd></div>}
              {(app.businessCity || app.businessState) && (
                <div className="flex justify-between"><dt className="text-gray-500">Location</dt><dd className="font-medium">{[app.businessCity, app.businessState, app.businessZip].filter(Boolean).join(", ")}</dd></div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Owner Info */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Owner Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Name</dt><dd className="font-medium">{app.ownerFirstName} {app.ownerLastName}</dd></div>
              {app.ownerSsnMasked && (
                <div className="flex justify-between items-center">
                  <dt className="text-gray-500 flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-green-500" /> SSN</dt>
                  <dd className="font-mono font-medium">{app.ownerSsnMasked}</dd>
                </div>
              )}
              {app.ownerDob && <div className="flex justify-between"><dt className="text-gray-500">Date of Birth</dt><dd className="font-medium">{new Date(app.ownerDob).toLocaleDateString()}</dd></div>}
              {app.ownershipPct != null && <div className="flex justify-between"><dt className="text-gray-500">Ownership</dt><dd className="font-medium">{app.ownershipPct}%</dd></div>}
              {(app.ownerHomeCity || app.ownerHomeState) && (
                <div className="flex justify-between"><dt className="text-gray-500">Home Location</dt><dd className="font-medium">{[app.ownerHomeCity, app.ownerHomeState].filter(Boolean).join(", ")}</dd></div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Financing Details */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Financing Request</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Type</dt><dd className="font-medium capitalize">{app.type.replace("_", " ")}</dd></div>
              {app.monthlyRevenueStated != null && <div className="flex justify-between"><dt className="text-gray-500">Monthly Revenue</dt><dd className="font-medium">{fmt(app.monthlyRevenueStated)}</dd></div>}
              {app.requestedAmount != null && <div className="flex justify-between"><dt className="text-gray-500">Requested Amount</dt><dd className="font-medium text-[#1F4E79]">{fmt(app.requestedAmount)}</dd></div>}
              {app.useOfFunds && <div className="flex justify-between gap-4"><dt className="text-gray-500 flex-shrink-0">Use of Funds</dt><dd className="font-medium text-right">{app.useOfFunds}</dd></div>}
              {app.type === "equipment" && (
                <>
                  {app.equipmentDescription && <div className="flex justify-between gap-4"><dt className="text-gray-500 flex-shrink-0">Equipment</dt><dd className="font-medium text-right">{app.equipmentDescription}</dd></div>}
                  {app.vendorName && <div className="flex justify-between"><dt className="text-gray-500">Vendor</dt><dd className="font-medium">{app.vendorName}</dd></div>}
                  {app.vendorQuoteAmount && <div className="flex justify-between"><dt className="text-gray-500">Quote</dt><dd className="font-medium">{fmt(parseFloat(app.vendorQuoteAmount))}</dd></div>}
                  {app.equipmentCondition && <div className="flex justify-between"><dt className="text-gray-500">Condition</dt><dd className="font-medium capitalize">{app.equipmentCondition}</dd></div>}
                </>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Consent + Signature */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-gray-700">Consents & Signature</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              {app.consentCreditPull
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
              <span className={app.consentCreditPull ? "text-gray-700" : "text-gray-400"}>Credit pull authorized</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {app.consentTerms
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
              <span className={app.consentTerms ? "text-gray-700" : "text-gray-400"}>Terms & Privacy agreed</span>
            </div>
            <div className="flex items-center gap-2 text-xs mt-2">
              {app.signatureData === "[signature on file]"
                ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                : <XCircle className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />}
              <span className={app.signatureData ? "text-gray-700" : "text-gray-400"}>
                {app.signatureData ? "Electronic signature on file" : "No signature"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Share link */}
      <div className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-3">
        <TrendingUp className="h-4 w-4 text-[#1F4E79] flex-shrink-0" />
        <span className="text-xs text-gray-500 flex-1">Share application link:</span>
        <code className="text-xs font-mono text-[#1F4E79] truncate max-w-[200px]">{applyUrl}</code>
        <Button variant="outline" size="sm" onClick={copyLink} className="flex items-center gap-1 flex-shrink-0 h-7 text-xs">
          <Copy className="h-3 w-3" /> Copy
        </Button>
      </div>
    </div>
  );
}

