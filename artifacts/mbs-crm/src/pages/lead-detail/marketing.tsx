import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, FileDown, Loader2, Megaphone, Send } from "lucide-react";
import { getDownloadFlyerUrl, useEmailFlyer, useGenerateFlyer, useListFlyerTemplates } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
function applyFieldValues(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? "");
}

// Marketing / Flyer Tab
export function LeadMarketing() {
  const { id: leadId, lead } = useLeadDetail();
  const { toast } = useToast();
  const { data: templates = [], isLoading: templatesLoading } = useListFlyerTemplates({ activeOnly: true });
  const generateFlyer = useGenerateFlyer();
  const emailFlyer = useEmailFlyer();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [lastFlyerId, setLastFlyerId] = useState<number | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Sort templates: matching program type first, then general, then rest
  const leadProgramType = lead.applicationType as string | null;
  const sortedTemplates = [...(templates as any[])].sort((a: any, b: any) => {
    const aMatch = a.programType === leadProgramType ? 0 : a.programType === "general" ? 1 : 2;
    const bMatch = b.programType === leadProgramType ? 0 : b.programType === "general" ? 1 : 2;
    return aMatch - bMatch;
  });

  const selectedTemplate = sortedTemplates.find((t: any) => String(t.id) === selectedTemplateId);

  // Live preview HTML — recomputed as field values change
  const previewHtml = selectedTemplate
    ? applyFieldValues(selectedTemplate.htmlTemplate ?? "", fieldValues)
    : "";

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    setLastFlyerId(null);
    setEmailSent(false);
    const tmpl = sortedTemplates.find((t: any) => String(t.id) === id);
    if (tmpl) {
      const defaults: Record<string, string> = {};
      for (const f of tmpl.variableFields ?? []) {
        if (f.key === "rep_name" && lead.assignedRep) defaults[f.key] = getUserDisplayName(lead.assignedRep);
        else if (f.key === "rep_email" && lead.assignedRep?.email) defaults[f.key] = lead.assignedRep.email;
        else if (f.key === "rep_phone" && lead.assignedRep?.phone) defaults[f.key] = lead.assignedRep.phone;
        else defaults[f.key] = f.defaultValue ?? "";
      }
      setFieldValues(defaults);
    }
  };

  const handleGenerate = () => {
    if (!selectedTemplateId) return;
    generateFlyer.mutate(
      { data: { templateId: Number(selectedTemplateId), fieldValues, leadId } },
      {
        onSuccess: (data: any) => {
          setLastFlyerId(data.flyerId);
          setEmailSent(false);
          // Auto-open download immediately
          window.open(getDownloadFlyerUrl(data.flyerId), "_blank");
          toast({ title: "Flyer generated!", description: "PDF download started. You can also email it below." });
        },
        onError: () => toast({ title: "Generation failed", variant: "destructive" }),
      }
    );
  };

  const handleEmail = () => {
    if (!lastFlyerId || !lead.email) return;
    emailFlyer.mutate(
      { id: lastFlyerId, data: { leadId } },
      {
        onSuccess: () => {
          setEmailSent(true);
          toast({ title: "Flyer emailed!", description: `Sent to ${lead.email}` });
        },
        onError: () => toast({ title: "Email failed", description: "Check SendGrid configuration.", variant: "destructive" }),
      }
    );
  };

  if (templatesLoading) {
    return <div className="mt-4 space-y-3"><div className="h-16 bg-muted animate-pulse rounded-lg" /><div className="h-16 bg-muted animate-pulse rounded-lg" /></div>;
  }

  if (sortedTemplates.length === 0) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center py-12 text-center">
        <Megaphone className="h-10 w-10 text-muted-foreground/30 mb-3" />
        <p className="font-medium text-muted-foreground">No flyer templates available</p>
        <p className="text-sm text-muted-foreground mt-1">Ask an admin to create templates in the Flyer Templates section.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Megaphone className="h-4 w-4 text-[#1F4E79]" /> Generate Marketing Flyer</CardTitle>
          <CardDescription className="text-xs">
            Select a template, customize the fields, preview live, then export PDF to download or email.
            {leadProgramType && <span className="ml-1 text-[#1F4E79] font-medium">(Best-match templates shown first.)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Flyer Template</Label>
            <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Choose a template..." /></SelectTrigger>
              <SelectContent>
                {sortedTemplates.map((t: any) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    {t.name}
                    {t.programType === leadProgramType && <span className="ml-1.5 text-xs text-[#1F4E79] font-medium">★</span>}
                    {t.programType !== "general" && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({t.programType === "working_capital" ? "Working Capital" : "Equipment"})
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTemplate && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customize Fields</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(selectedTemplate.variableFields ?? []).map((f: any) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs">{f.label}</Label>
                    {f.type === "select" && Array.isArray(f.options) && f.options.length > 0 ? (
                      <Select
                        value={fieldValues[f.key] ?? f.defaultValue ?? ""}
                        onValueChange={(v) => setFieldValues((prev) => ({ ...prev, [f.key]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {f.options.map((opt: string) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        type={f.type === "number" ? "number" : "text"}
                        className="h-8 text-xs"
                        value={fieldValues[f.key] ?? f.defaultValue ?? ""}
                        onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={f.defaultValue}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Preview Panel */}
          {selectedTemplate && (
            <div className="pt-2 border-t space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Live Preview</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </Button>
              </div>
              {showPreview && (
                <div className="border rounded-lg overflow-hidden shadow-sm bg-white">
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-same-origin"
                    className="w-full"
                    style={{ height: "520px", border: "none" }}
                    title="Flyer Preview"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button
              className="h-9 text-sm"
              onClick={handleGenerate}
              disabled={!selectedTemplateId || generateFlyer.isPending}
            >
              {generateFlyer.isPending
                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating...</>
                : <><FileDown className="h-3.5 w-3.5 mr-1.5" /> Export PDF</>}
            </Button>

            {lastFlyerId && lead.email && (
              <Button
                variant="outline"
                className="h-9 text-sm"
                onClick={handleEmail}
                disabled={emailFlyer.isPending || emailSent}
              >
                {emailSent
                  ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600" /> Emailed</>
                  : emailFlyer.isPending
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending...</>
                    : <><Send className="h-3.5 w-3.5 mr-1.5" /> Email to Lead</>}
              </Button>
            )}
            {lastFlyerId && !lead.email && (
              <p className="text-xs text-muted-foreground self-center">(No email on file — cannot email)</p>
            )}
          </div>

          {lastFlyerId && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Flyer exported and saved to this lead's documents. Download opened automatically.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
