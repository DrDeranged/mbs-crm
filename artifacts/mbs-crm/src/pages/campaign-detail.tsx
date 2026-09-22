import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  useGetCampaign,
  useUpdateCampaign,
  useApproveCampaign,
  usePreviewCampaignAudience,
  useDryRunCampaignTest,
  useLaunchCampaign,
  getGetCampaignQueryKey,
  useListEmailTemplates,
  getGetCampaignResultsQueryKey,
  useGetCampaignResults,
  usePauseCampaign,
  useCancelCampaign,
  useListCampaignAudiencePresets,
  useCreateCampaignAudiencePreset,
  useUpdateCampaignAudiencePreset,
  useDeleteCampaignAudiencePreset,
  getListCampaignAudiencePresetsQueryKey,
  useListUsers,
  useListCampaignFlyers,
} from "@workspace/api-client-react";
import { 
  CheckCircle2, AlertTriangle, Play, Calendar, ArrowLeft,
  Mail, MessageSquare, Save, Users, ShieldCheck, Download, Image as ImageIcon,
  Pause, XCircle, BarChart3, Bookmark, Trash2, Pencil
  , Upload, X, FileText
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getStatusColor } from "./campaigns";
import { getApiBaseUrl } from "@/lib/apiBase";
import { format } from "date-fns";
import { isCampaignPreviewFresh, serializeAudienceRules, validateCampaignFlyerFile } from "@/lib/campaignLauncher";

const campaignSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  channel: z.enum(["email", "sms", "email_sms"]),
  emailTemplateId: z.string().optional().nullable(),
  smsBody: z.string().optional().nullable(),
  flyer: z.any().nullable().optional(),
  audienceRules: z.object({
    statuses: z.array(z.string()).optional(),
    programTypes: z.array(z.string()).optional(),
    assignedRepId: z.string().optional().nullable(),
    leadSources: z.array(z.string()).optional(),
    createdFrom: z.string().optional().nullable(),
    createdTo: z.string().optional().nullable(),
    minAmount: z.string().optional().nullable(),
    maxAmount: z.string().optional().nullable(),
  })
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

const STATUS_OPTIONS = [
  ["new_lead", "New lead"], ["contacted", "Contacted"], ["application_received", "Application received"],
  ["submitted_to_underwriting", "Submitted to underwriting"],
  ["approved", "Approved"], ["funded", "Funded"], ["declined", "Declined"], ["follow_up", "Follow up"],
] as const;
const SOURCE_OPTIONS = [
  ["manual", "Manual"], ["website", "Website"], ["referral", "Referral"],
  ["import", "Imported"], ["qr-card", "QR card"], ["usfundadvisor", "US Fund Advisor"],
] as const;
const PROGRAM_OPTIONS = [["equipment", "Equipment financing"], ["working_capital", "Working capital"]] as const;

function GuidedMultiSelect({ value = [], options, onChange, label }: {
  value?: string[];
  options: readonly (readonly [string, string])[];
  onChange: (value: string[]) => void;
  label: string;
}) {
  return (
    <fieldset className="rounded-lg border bg-white p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid max-h-44 gap-1 overflow-auto sm:grid-cols-2">
        {options.map(([key, text]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
            <Checkbox checked={value.includes(key)} onCheckedChange={(checked) =>
              onChange(checked ? [...value, key] : value.filter((item) => item !== key))
            } />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const normalizeCampaign = (campaign: any): CampaignFormValues => {
  return {
    name: campaign.name || "",
    description: campaign.description || "",
    channel: (campaign.channel as any) || "email",
    emailTemplateId: campaign.emailTemplateId ? String(campaign.emailTemplateId) : "__none__",
    smsBody: campaign.smsBody || "",
    flyer: campaign.flyer || null,
    audienceRules: {
      statuses: campaign.audienceRules?.statuses || [],
      programTypes: campaign.audienceRules?.programTypes || [],
      assignedRepId: campaign.audienceRules?.assignedRepId ? String(campaign.audienceRules.assignedRepId) : "__none__",
      leadSources: campaign.audienceRules?.leadSources || [],
      createdFrom: campaign.audienceRules?.createdFrom || "",
      createdTo: campaign.audienceRules?.createdTo || "",
      minAmount: campaign.audienceRules?.minAmount != null ? String(campaign.audienceRules.minAmount) : "",
      maxAmount: campaign.audienceRules?.maxAmount != null ? String(campaign.audienceRules.maxAmount) : "",
    }
  };
};

const getErrorMsg = (err: any, fallback: string) => {
  if (err?.data?.error && typeof err.data.error === "string") return err.data.error;
  if (err?.data?.message && typeof err.data.message === "string") return err.data.message;
  if (err?.message && typeof err.message === "string") return err.message;
  return fallback;
};

export default function CampaignDetailPage() {
  const [, params] = useRoute("/campaigns/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const { data, isLoading } = useGetCampaign(id, { query: { enabled: !!id, queryKey: getGetCampaignQueryKey(id) } });
  const campaign = data?.campaign;
  
  const { data: results } = useGetCampaignResults(id, { query: { enabled: !!id && campaign?.status !== "draft", queryKey: getGetCampaignResultsQueryKey(id) } });
  const { data: templates } = useListEmailTemplates();
  const { data: presets } = useListCampaignAudiencePresets({ query: { queryKey: getListCampaignAudiencePresetsQueryKey() } });
  const { data: users } = useListUsers();
  const { data: uploadedFlyers } = useListCampaignFlyers();

  const updateCampaign = useUpdateCampaign();
  const approveCampaign = useApproveCampaign();
  const previewAudience = usePreviewCampaignAudience();
  const launchCampaign = useLaunchCampaign();
  const dryRunTest = useDryRunCampaignTest();
  const pauseCampaign = usePauseCampaign();
  const cancelCampaign = useCancelCampaign();
  
  const createPreset = useCreateCampaignAudiencePreset();
  const deletePreset = useDeleteCampaignAudiencePreset();
  const updatePreset = useUpdateCampaignAudiencePreset();

  const [activeTab, setActiveTab] = useState("content");
  const [testEmail, setTestEmail] = useState("");
  
  const [previewedVersion, setPreviewedVersion] = useState<number | null>(null);
  const [claimsAffirmed, setClaimsAffirmed] = useState(false);

  const [launchDialogOpen, setLaunchDialogOpen] = useState(false);
  const [launchMode, setLaunchMode] = useState<"live" | "scheduled">("live");
  const [scheduledAt, setScheduledAt] = useState<string>("");

  const [presetDialogOpen, setPresetDialogOpen] = useState<false | "create" | "rename">(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [isUploadingFlyer, setIsUploadingFlyer] = useState(false);

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: "",
      description: "",
      channel: "email",
      emailTemplateId: "__none__",
      smsBody: "",
      flyer: null,
      audienceRules: {
        statuses: [],
        programTypes: [],
        assignedRepId: "__none__",
        leadSources: [],
        createdFrom: "",
        createdTo: "",
        minAmount: "",
        maxAmount: "",
      }
    }
  });

  const isDirty = form.formState.isDirty;

  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (campaign && templates) {
      const identity = `${campaign.id}-${campaign.version}`;
      if (initialized.current !== identity) {
        form.reset(normalizeCampaign(campaign));
        initialized.current = identity;
      }
    }
  }, [campaign, templates, form]);

  const onSubmit = (values: CampaignFormValues) => {
    const payload = {
      ...values,
      description: values.description === "" ? null : values.description,
      smsBody: values.smsBody === "" ? null : values.smsBody,
      emailTemplateId: values.emailTemplateId === "__none__" || !values.emailTemplateId ? null : Number(values.emailTemplateId),
      audienceRules: {
        ...serializeAudienceRules(values.audienceRules),
      }
    };

    updateCampaign.mutate({ id, data: payload as any }, {
      onSuccess: (updated) => {
        toast.success("Campaign saved");
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        if (campaign?.status === "approved" || campaign?.status === "paused" || campaign?.status === "failed") {
          toast.info("Changes invalidated approval status. Re-approval required.");
        }
        
        // Reset form to latest server state to clear isDirty, preserving emailTemplateId
        const identity = `${updated.id}-${updated.version}`;
        form.reset(normalizeCampaign(updated));
        
        initialized.current = identity;
        setPreviewedVersion(null); // Clear preview tracking because changes need a new preview
        queryClient.setQueryData(getGetCampaignQueryKey(id), (old: any) => 
          old ? { ...old, campaign: updated } : old
        );
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to save campaign"))
    });
  };

  const selectBuiltInFlyer = (key: "equipment_financing" | "working_capital", name: string) => {
    form.setValue("flyer", { source: "built_in", key, name, contentType: "image/png" }, { shouldDirty: true });
    setUploadError("");
  };

  const handleFlyerUpload = async (file?: File) => {
    if (!file) return;
    const validationError = validateCampaignFlyerFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploadError("");
    setUploadProgress(5);
    setIsUploadingFlyer(true);
    try {
      const request = await fetch(`${getApiBaseUrl()}/storage/campaign-flyers/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      const upload = await request.json();
      if (!request.ok) throw new Error(upload.error || "Could not prepare upload");
      setUploadProgress(35);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", upload.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(35 + Math.round((event.loaded / event.total) * 60));
        };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Upload failed"));
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(file);
      });
      form.setValue("flyer", {
        source: "uploaded", objectPath: upload.objectPath, name: file.name,
        contentType: file.type, size: file.size,
      }, { shouldDirty: true });
      setUploadProgress(100);
      toast.success("Flyer uploaded. Save changes to attach it to this campaign.");
    } catch (error: any) {
      setUploadError(error?.message || "Flyer upload failed");
      setUploadProgress(0);
    } finally {
      setIsUploadingFlyer(false);
    }
  };

  const handleApprove = () => {
    const previewToken = previewAudience.data?.previewToken;
    if (!previewToken) {
      toast.error("Calculate a fresh audience preview before approving");
      return;
    }
    approveCampaign.mutate({ id, data: { previewToken, claimsAffirmed: true } }, {
      onSuccess: () => {
        toast.success("Campaign approved for launch");
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to approve campaign"))
    });
  };

  const handlePreview = () => {
    previewAudience.mutate({ id }, {
      onSuccess: () => {
        toast.success("Audience calculated successfully");
        setPreviewedVersion(campaign?.version ?? null);
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to calculate audience"))
    });
  };

  const handleTest = () => {
    if (!testEmail) {
      toast.error("Enter a test email address");
      return;
    }
    dryRunTest.mutate({ id, data: { toEmail: testEmail } }, {
      onSuccess: () => toast.success("Provider-free validation triggered"),
      onError: (err: any) => toast.error(getErrorMsg(err, "Validation failed"))
    });
  };

  const confirmLaunch = () => {
    if (campaign?.channel === 'sms' || campaign?.channel === 'email_sms') {
      toast.error("SMS launching is currently disabled in this environment.");
      return;
    }

    if (needsPreview || !previewAudience.data?.previewToken) {
      toast.error("A fresh preview is required before launching.");
      return;
    }

    if (campaign?.status !== "approved") {
      toast.error("Campaign must be approved before launching.");
      return;
    }

    const payload: any = {
      idempotencyKey: crypto.randomUUID(),
      mode: "live"
    };

    if (launchMode === "scheduled") {
      if (!scheduledAt) {
        toast.error("Please enter a scheduled time");
        return;
      }
      payload.scheduledAt = new Date(scheduledAt).toISOString();
    }

    launchCampaign.mutate({
      id,
      data: payload
    }, {
      onSuccess: () => {
        if (launchMode === "scheduled") {
          toast.success("Campaign queued. Note: Scheduled launch currently persists timing only. No automatic worker will deliver this.");
        } else {
          toast.success("Campaign launched successfully in live mode!");
        }
        setLaunchDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getGetCampaignResultsQueryKey(id) });
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to launch campaign"))
    });
  };

  const [selectedPresetId, setSelectedPresetId] = useState<string>("none");

  const handleApplyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === "none") return;
    const preset = presets?.find(p => p.id === Number(presetId));
    if (preset) {
      form.setValue("audienceRules", preset.rules as any, { shouldDirty: true });
      toast.success(`Applied preset: ${preset.name}`);
    }
  };

  const handleDeletePreset = () => {
    if (selectedPresetId === "none") return;
    deletePreset.mutate({ id: Number(selectedPresetId) }, {
      onSuccess: () => {
        toast.success("Preset deleted");
        setSelectedPresetId("none");
        queryClient.invalidateQueries({ queryKey: getListCampaignAudiencePresetsQueryKey() });
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to delete preset"))
    });
  };

  const handleRenamePreset = () => {
    if (selectedPresetId === "none" || !newPresetName) return;
    updatePreset.mutate({ id: Number(selectedPresetId), data: { name: newPresetName } }, {
      onSuccess: () => {
        toast.success("Preset renamed");
        setPresetDialogOpen(false);
        setNewPresetName("");
        queryClient.invalidateQueries({ queryKey: getListCampaignAudiencePresetsQueryKey() });
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to rename preset"))
    });
  };

  const handleSavePreset = () => {
    if (!newPresetName) {
      toast.error("Enter a preset name");
      return;
    }
    if (presetDialogOpen === "rename") {
      handleRenamePreset();
      return;
    }
    const currentRules = form.getValues().audienceRules;
    createPreset.mutate({ data: { name: newPresetName, rules: currentRules as any } }, {
      onSuccess: (newPreset) => {
        toast.success("Preset saved");
        setPresetDialogOpen(false);
        setNewPresetName("");
        setSelectedPresetId(String(newPreset.id));
        queryClient.invalidateQueries({ queryKey: getListCampaignAudiencePresetsQueryKey() });
      },
      onError: (err: any) => toast.error(getErrorMsg(err, "Failed to save preset"))
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center p-24"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  if (!campaign) {
    return <div className="p-12 text-center">Campaign not found</div>;
  }

  const isFinancingCampaign = campaign.name.toLowerCase().includes("financing");
  const isApproved = campaign.status === "approved";
  const needsPreview = !isCampaignPreviewFresh({
    dirty: isDirty, previewedVersion, campaignVersion: campaign.version, previewToken: previewAudience.data?.previewToken,
  });
  const selectedTemplate = templates?.find(t => String(t.id) === form.watch("emailTemplateId"));
  const selectedFlyer = form.watch("flyer") as any;
  const selectedFlyerUrl = selectedFlyer?.source === "built_in"
    ? `${getApiBaseUrl()}/collateral/campaign-assets/${selectedFlyer.key === "equipment_financing" ? "equipment-financing" : "working-capital"}`
    : selectedFlyer?.objectPath ? `${getApiBaseUrl()}/storage${selectedFlyer.objectPath}` : null;
  const audienceRules = form.watch("audienceRules");
  const isColdListAudience = (audienceRules.leadSources || []).some((source) => source === "import" || source === "purchased");
  const activeFilters = [
    ...(audienceRules.statuses || []).map((value) => ({ key: `status:${value}`, label: STATUS_OPTIONS.find(([key]) => key === value)?.[1] || value, clear: () => form.setValue("audienceRules.statuses", (audienceRules.statuses || []).filter((item) => item !== value), { shouldDirty: true }) })),
    ...(audienceRules.leadSources || []).map((value) => ({ key: `source:${value}`, label: SOURCE_OPTIONS.find(([key]) => key === value)?.[1] || value, clear: () => form.setValue("audienceRules.leadSources", (audienceRules.leadSources || []).filter((item) => item !== value), { shouldDirty: true }) })),
    ...(audienceRules.programTypes || []).map((value) => ({ key: `program:${value}`, label: PROGRAM_OPTIONS.find(([key]) => key === value)?.[1] || value, clear: () => form.setValue("audienceRules.programTypes", (audienceRules.programTypes || []).filter((item) => item !== value), { shouldDirty: true }) })),
    ...(audienceRules.assignedRepId && audienceRules.assignedRepId !== "__none__" ? [{ key: "rep", label: `Rep: ${users?.find((u) => String(u.id) === audienceRules.assignedRepId)?.name || "Selected"}`, clear: () => form.setValue("audienceRules.assignedRepId", "__none__", { shouldDirty: true }) }] : []),
    ...(audienceRules.createdFrom ? [{ key: "from", label: `From ${audienceRules.createdFrom}`, clear: () => form.setValue("audienceRules.createdFrom", "", { shouldDirty: true }) }] : []),
    ...(audienceRules.createdTo ? [{ key: "to", label: `To ${audienceRules.createdTo}`, clear: () => form.setValue("audienceRules.createdTo", "", { shouldDirty: true }) }] : []),
    ...(audienceRules.minAmount ? [{ key: "min", label: `Min $${Number(audienceRules.minAmount).toLocaleString()}`, clear: () => form.setValue("audienceRules.minAmount", "", { shouldDirty: true }) }] : []),
    ...(audienceRules.maxAmount ? [{ key: "max", label: `Max $${Number(audienceRules.maxAmount).toLocaleString()}`, clear: () => form.setValue("audienceRules.maxAmount", "", { shouldDirty: true }) }] : []),
  ];
  const clearAllFilters = () => form.setValue("audienceRules", {
    statuses: [], programTypes: [], assignedRepId: "__none__", leadSources: [],
    createdFrom: "", createdTo: "", minAmount: "", maxAmount: "",
  }, { shouldDirty: true });
  const requiresEmailTemplate = campaign.channel === "email" || campaign.channel === "email_sms";
  const hasInactiveTemplate = requiresEmailTemplate && selectedTemplate && !selectedTemplate.isActive;
  const canApprove = !isDirty && !needsPreview && claimsAffirmed && !hasInactiveTemplate;

  const safeguards = [
    "Email suppression and unsubscribe checks remain enforced",
    "SMS consent, STOP opt-out, and USFA consent checks remain enforced",
    "Email sender remains My Business Solutions; replies route to the valid assigned rep",
    "Email legal address, unsubscribe footer, tracking, and daily marketing limit remain enforced",
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-shrink-0 flex-col items-stretch justify-between gap-4 border-b bg-white px-4 py-4 lg:flex-row lg:items-center lg:px-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/campaigns")} className="shrink-0 -ml-2 text-slate-500">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{campaign.name}</h1>
              <Badge variant="secondary" className={getStatusColor(campaign.status)}>
                {campaign.status.toUpperCase()}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">Campaign ID: {campaign.id} • Version: {campaign.version}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(campaign.status === "draft" || campaign.status === "approved" || campaign.status === "paused" || campaign.status === "failed") && (
            <Button variant="outline" onClick={() => form.handleSubmit(onSubmit)()} disabled={!isDirty || updateCampaign.isPending}>
              <Save className="mr-2 h-4 w-4" />
              {updateCampaign.isPending ? "Saving..." : "Save Changes"}
            </Button>
          )}

          {campaign.status === "running" && (
            <Button variant="secondary" onClick={() => pauseCampaign.mutate({ id }, {
              onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) }),
              onError: (err: any) => toast.error(getErrorMsg(err, "Failed to pause"))
            })} disabled={pauseCampaign.isPending}>
              <Pause className="mr-2 h-4 w-4" /> Pause Campaign
            </Button>
          )}

          {(campaign.status === "scheduled" || campaign.status === "paused") && (
            <Button variant="destructive" onClick={() => cancelCampaign.mutate({ id }, {
              onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(id) }),
              onError: (err: any) => toast.error(getErrorMsg(err, "Failed to cancel"))
            })} disabled={cancelCampaign.isPending}>
              <XCircle className="mr-2 h-4 w-4" /> Cancel Campaign
            </Button>
          )}

          {campaign.status === "draft" && (
            <div className="flex items-center gap-2">
              <Button 
                onClick={handleApprove} 
                disabled={!canApprove || approveCampaign.isPending} 
                variant="secondary" 
                className={!canApprove ? "opacity-50 cursor-not-allowed" : ""}
                title={!canApprove ? "Please save changes, select an active template, run a fresh preview, and affirm claims before approving." : ""}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Approve Campaign
              </Button>
            </div>
          )}
          {isApproved && (
            <Button variant="outline" className="text-primary border-primary/20 hover:bg-primary/5" onClick={() => setActiveTab("review")}>
              Ready to Launch →
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <div className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Content", Boolean(form.watch("emailTemplateId") !== "__none__" || !requiresEmailTemplate)],
                  ["Attachment", true], ["Audience", activeFilters.length > 0],
                  ["Preview", !needsPreview], ["Approval", campaign.status === "approved"], ["Launch", ["scheduled", "running", "completed"].includes(campaign.status)],
                ].map(([label, complete], index) => (
                  <div key={String(label)} className={`rounded-lg border px-3 py-2 ${complete ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-500"}`}>
                    <span className="mr-1 font-semibold">{index + 1}.</span>{label}
                    {complete && <CheckCircle2 className="ml-1 inline h-3.5 w-3.5" />}
                  </div>
                ))}
              </div>
              <TabsList className="grid w-full grid-cols-4 bg-slate-100">
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="audience">Audience</TabsTrigger>
              <TabsTrigger value="review">Review</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
              </TabsList>
            </div>

            <Form {...form}>
              <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
                
                <TabsContent value="content" className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                      <CardHeader>
                        <CardTitle>Basic Info</CardTitle>
                        <CardDescription>Name and channel configuration.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Campaign Name</FormLabel>
                              <FormControl><Input {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="description"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Description</FormLabel>
                              <FormControl><Textarea {...field} value={field.value || ""} rows={3} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="channel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Channel</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value || "email"}>
                                <FormControl>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="email">Email Only</SelectItem>
                                  <SelectItem value="sms">SMS Only</SelectItem>
                                  <SelectItem value="email_sms">Email & SMS</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </CardContent>
                    </Card>

                    <div className="space-y-6">
                      {(form.watch("channel") === "email" || form.watch("channel") === "email_sms") && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" />Email Template</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <FormField
                              control={form.control}
                              name="emailTemplateId"
                              render={({ field }) => (
                                <FormItem>
                                  <Select onValueChange={field.onChange} value={field.value || "__none__"}>
                                    <FormControl>
                                      <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="__none__">None / Custom</SelectItem>
                                      {templates?.map(t => (
                                        <SelectItem key={t.id} value={String(t.id)}>
                                          {t.name} {!t.isActive && "(Inactive)"}
                                        </SelectItem>
                                      ))}
                                      {field.value && field.value !== "__none__" && templates && !templates.some(t => String(t.id) === field.value) && (
                                        <SelectItem value={field.value} disabled>Unknown Template ({field.value})</SelectItem>
                                      )}
                                    </SelectContent>
                                  </Select>
                                  <FormDescription>Select an approved template from the library.</FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </CardContent>
                        </Card>
                      )}

                      {(form.watch("channel") === "sms" || form.watch("channel") === "email_sms") && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" />SMS Content</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                              <strong>Note:</strong> Live SMS launch is currently unavailable. You may preview SMS content and audience, but launching is disabled to prevent misleading success states.
                            </div>
                            <FormField
                              control={form.control}
                              name="smsBody"
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl><Textarea {...field} value={field.value || ""} rows={4} placeholder="Hi {{lead_first_name}}, ..." /></FormControl>
                                  <FormDescription className="text-amber-600 font-medium">You must include opt-out language such as 'Reply STOP to opt out' manually. It is not appended automatically.</FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Campaign flyer</CardTitle>
                      <CardDescription>Choose an MBS design or upload a reusable flyer. Changing the flyer requires a new preview and approval.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {[
                          { key: "equipment_financing" as const, name: "Equipment Financing", slug: "equipment-financing" },
                          { key: "working_capital" as const, name: "Working Capital", slug: "working-capital" },
                        ].map((flyer) => {
                          const chosen = selectedFlyer?.source === "built_in" && selectedFlyer.key === flyer.key;
                          return (
                            <button key={flyer.key} type="button" aria-pressed={chosen}
                              onClick={() => selectBuiltInFlyer(flyer.key, flyer.name)}
                              className={`overflow-hidden rounded-xl border-2 bg-white text-left transition ${chosen ? "border-primary ring-2 ring-primary/20" : "border-slate-200 hover:border-slate-400"}`}>
                              <img src={`${getApiBaseUrl()}/collateral/campaign-assets/${flyer.slug}`} alt={`${flyer.name} flyer`} className="aspect-[2/3] w-full object-cover" />
                              <span className="flex items-center justify-between p-3 text-sm font-semibold">
                                {flyer.name}{chosen && <CheckCircle2 className="h-4 w-4 text-primary" />}
                              </span>
                            </button>
                          );
                        })}
                        <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-primary">
                          <Upload className="mb-3 h-8 w-8 text-slate-400" />
                          <span className="font-semibold">Upload a flyer</span>
                          <span className="mt-1 text-xs text-slate-500">PNG, JPG, WebP, or PDF · 15 MB max</span>
                          <input className="sr-only" type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
                            onChange={(event) => handleFlyerUpload(event.target.files?.[0])} disabled={isUploadingFlyer} />
                        </label>
                        {uploadedFlyers?.map((flyer) => {
                          const chosen = selectedFlyer?.source === "uploaded" && selectedFlyer.objectPath === flyer.objectPath;
                          const src = `${getApiBaseUrl()}/storage${flyer.objectPath}`;
                          return (
                            <button key={flyer.objectPath} type="button" aria-pressed={chosen}
                              onClick={() => form.setValue("flyer", flyer, { shouldDirty: true })}
                              className={`overflow-hidden rounded-xl border-2 bg-white text-left transition ${chosen ? "border-primary ring-2 ring-primary/20" : "border-slate-200 hover:border-slate-400"}`}>
                              {flyer.contentType === "application/pdf"
                                ? <div className="flex aspect-[2/3] items-center justify-center bg-slate-100"><FileText className="h-16 w-16 text-red-500" /></div>
                                : <img src={src} alt="" className="aspect-[2/3] w-full object-cover" />}
                              <span className="flex items-center justify-between gap-2 p-3 text-sm font-semibold">
                                <span className="truncate">{flyer.name}</span>{chosen && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {isUploadingFlyer && (
                        <div aria-live="polite">
                          <div className="mb-1 flex justify-between text-xs"><span>Uploading flyer</span><span>{uploadProgress}%</span></div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-primary transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                        </div>
                      )}
                      {uploadError && <p role="alert" className="text-sm text-red-600">{uploadError}</p>}
                      {selectedFlyer && (
                        <div className="flex items-center gap-4 rounded-xl border bg-slate-50 p-4">
                          {selectedFlyer.contentType === "application/pdf" ? <FileText className="h-10 w-10 text-red-500" /> :
                            <img src={selectedFlyerUrl || ""} alt="" className="h-20 w-14 rounded object-cover" />}
                          <div className="min-w-0 flex-1"><p className="font-semibold">Selected creative</p><p className="truncate text-sm text-slate-500">{selectedFlyer.name}</p></div>
                          <Button type="button" variant="ghost" size="icon" aria-label="Clear selected flyer" onClick={() => form.setValue("flyer", null, { shouldDirty: true })}><X className="h-4 w-4" /></Button>
                        </div>
                      )}
                      {!selectedFlyer && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                          Attachment: none. This campaign will send a plain-text message with a minimal HTML alternative and no images or attachments.
                        </div>
                      )}
                      {selectedFlyer && isColdListAudience && (
                        <div role="alert" className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          Attachments on cold outreach are commonly filtered as spam.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="audience" className="space-y-6">
                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between pb-4">
                      <div>
                        <CardTitle>Audience Rules</CardTitle>
                        <CardDescription>Define criteria for leads to be included in this campaign.</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select onValueChange={handleApplyPreset} value={selectedPresetId}>
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Apply saved preset..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Custom Rules</SelectItem>
                            {presets?.map(p => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedPresetId !== "none" && (
                          <>
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="icon" 
                              onClick={() => {
                                const preset = presets?.find(p => p.id === Number(selectedPresetId));
                                setNewPresetName(preset?.name || "");
                                setPresetDialogOpen("rename");
                              }} 
                              title="Rename preset"
                            >
                              <Pencil className="h-4 w-4 text-slate-500" />
                            </Button>
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="icon" 
                              onClick={handleDeletePreset} 
                              disabled={deletePreset.isPending}
                              title="Delete preset"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </>
                        )}
                        <Dialog open={!!presetDialogOpen} onOpenChange={(open) => !open && setPresetDialogOpen(false)}>
                          <Button type="button" variant="outline" size="icon" onClick={() => { setNewPresetName(""); setPresetDialogOpen("create"); }} title="Save current rules as preset">
                            <Bookmark className="h-4 w-4 text-primary" />
                          </Button>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>{presetDialogOpen === "rename" ? "Rename Preset" : "Save Audience Preset"}</DialogTitle>
                              <DialogDescription>
                                {presetDialogOpen === "rename" ? "Enter a new name for this preset." : "Save the current rules to reuse in future campaigns."}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                              <Label htmlFor="presetName">Preset Name</Label>
                              <Input 
                                id="presetName" 
                                value={newPresetName} 
                                onChange={e => setNewPresetName(e.target.value)} 
                                placeholder="e.g. Q3 Healthcare Renewals" 
                                className="mt-2"
                              />
                            </div>
                            <DialogFooter>
                              <Button type="button" variant="outline" onClick={() => setPresetDialogOpen(false)}>Cancel</Button>
                              <Button type="button" onClick={handleSavePreset} disabled={createPreset.isPending || updatePreset.isPending}>
                                {presetDialogOpen === "rename" ? "Rename Preset" : "Save Preset"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-6 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-medium">Active filters <span className="text-slate-500">({activeFilters.length})</span></p>
                          {activeFilters.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters}>Clear all</Button>}
                        </div>
                        <div className="flex min-h-10 flex-wrap gap-2 rounded-lg border bg-slate-50 p-2">
                          {activeFilters.length === 0 ? <span className="px-2 py-1 text-sm text-slate-500">No filters — all leads will be evaluated.</span> :
                            activeFilters.map((filter) => <Badge key={filter.key} variant="secondary" className="gap-1 py-1">{filter.label}<button type="button" onClick={filter.clear} aria-label={`Clear ${filter.label}`}><X className="h-3 w-3" /></button></Badge>)}
                        </div>
                      </div>
                      <FormField
                        control={form.control}
                        name="audienceRules.statuses"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Lead Statuses</FormLabel>
                            <FormControl><GuidedMultiSelect label="Lead statuses" value={field.value} options={STATUS_OPTIONS} onChange={field.onChange} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="audienceRules.leadSources"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Lead Sources</FormLabel>
                            <FormControl><GuidedMultiSelect label="Lead sources" value={field.value} options={SOURCE_OPTIONS} onChange={field.onChange} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="audienceRules.programTypes"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Program Types</FormLabel>
                            <FormControl><GuidedMultiSelect label="Program types" value={field.value} options={PROGRAM_OPTIONS} onChange={field.onChange} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="audienceRules.assignedRepId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Rep</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || "__none__"}>
                              <FormControl>
                                <SelectTrigger><SelectValue placeholder="Any Rep" /></SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">Any Rep (No filter)</SelectItem>
                                {users?.map(u => (
                                  <SelectItem key={u.id} value={String(u.id)}>{u.name || u.email}</SelectItem>
                                ))}
                                {field.value && field.value !== "__none__" && users && !users.some(u => String(u.id) === field.value) && (
                                  <SelectItem value={field.value} disabled>Unknown Rep ({field.value})</SelectItem>
                                )}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="audienceRules.createdFrom"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Created From (Date)</FormLabel>
                              <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="audienceRules.createdTo"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Created To (Date)</FormLabel>
                              <FormControl><Input type="date" {...field} value={field.value || ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="audienceRules.minAmount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Min Amount</FormLabel>
                              <FormControl><Input type="number" {...field} value={field.value || ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="audienceRules.maxAmount"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Max Amount</FormLabel>
                              <FormControl><Input type="number" {...field} value={field.value || ""} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="review" className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                      <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-1">
                          <CardTitle>Audience Preview</CardTitle>
                          <CardDescription>Calculate who will receive this campaign.</CardDescription>
                        </div>
                        <Button type="button" onClick={handlePreview} variant="secondary" size="sm" disabled={previewAudience.isPending || isDirty}>
                          {previewAudience.isPending ? "Calculating..." : "Calculate"}
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4 rounded-lg border bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                          Attachment: {selectedFlyer?.name || "none"}
                        </div>
                        {isDirty && (
                          <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                            <strong>Unsaved changes:</strong> Please save the campaign before calculating the audience.
                          </div>
                        )}
                        {previewAudience.data && !isDirty ? (
                          <div className="space-y-4 mt-2">
                            {needsPreview && (
                              <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                                <strong>Stale preview:</strong> You have saved changes since the last preview. Click Calculate to refresh.
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                              <div className="rounded-lg border bg-slate-50 p-4">
                                <div className="text-2xl font-bold text-slate-900">{previewAudience.data.counts.eligible}</div>
                                <div className="text-xs text-slate-500 font-medium uppercase">Eligible</div>
                              </div>
                              <div className="rounded-lg border bg-slate-50 p-4">
                                <div className="text-2xl font-bold text-slate-900">{previewAudience.data.counts.excluded}</div>
                                <div className="text-xs text-slate-500 font-medium uppercase">Excluded</div>
                              </div>
                            </div>
                            <div className="space-y-2 text-sm text-slate-600">
                              <p className="flex justify-between border-b pb-1"><span>Email Eligible</span> <strong>{previewAudience.data.counts.emailEligible}</strong></p>
                              <p className="flex justify-between border-b pb-1"><span>SMS Eligible</span> <strong>{previewAudience.data.counts.smsEligible}</strong></p>
                              <p className="flex justify-between border-b pb-1"><span>Email Capacity Left</span> <strong>{previewAudience.data.counts.emailCapacityRemaining}</strong></p>
                            </div>
                            {previewAudience.data.exclusions.length > 0 && (
                              <div className="mt-4 border rounded-lg overflow-hidden">
                                <div className="bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 border-b">Sample Exclusions</div>
                                <div className="max-h-[150px] overflow-auto">
                                  {previewAudience.data.exclusions.slice(0, 10).map((ex, i) => (
                                    <div key={i} className="px-3 py-2 text-sm border-b last:border-0 hover:bg-slate-50 flex items-center justify-between">
                                      <span className="font-medium text-slate-700">Lead {ex.leadId}</span>
                                      <span className="text-slate-500 text-xs truncate max-w-[200px]" title={ex.reason}>{ex.reason}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center p-8 text-center text-slate-500">
                            <Users className="mb-2 h-8 w-8 opacity-20" />
                            <p className="text-sm">Click Calculate to generate preview.</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Provider-Free Validation Test</CardTitle>
                        <CardDescription>Test content rendering. No actual emails will be delivered.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex gap-2">
                          <Input 
                            placeholder="test@example.com" 
                            type="email" 
                            value={testEmail} 
                            onChange={e => setTestEmail(e.target.value)} 
                          />
                          <Button type="button" onClick={handleTest} disabled={dryRunTest.isPending} variant="secondary">
                            Run Validation
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Schedule & Launch</CardTitle>
                        <CardDescription>Finalize your campaign launch configuration.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {campaign.status !== "approved" ? (
                          <div className="rounded-lg border bg-slate-50 p-6 text-center text-slate-500">
                            <ShieldCheck className="mx-auto mb-2 h-8 w-8 opacity-20" />
                            <p>Campaign must be approved before launching.</p>
                            {needsPreview && <p className="text-xs text-amber-600 mt-2">Requires a fresh audience preview.</p>}
                            {isDirty && <p className="text-xs text-amber-600 mt-2">Requires saving changes.</p>}
                            {isFinancingCampaign && !claimsAffirmed && <p className="text-xs text-amber-600 mt-2">Requires affirming financing claims.</p>}
                            {hasInactiveTemplate && <p className="text-xs text-red-600 mt-2 font-medium">An active email template is required for approval.</p>}
                          </div>
                        ) : needsPreview ? (
                          <div className="rounded-lg border bg-amber-50 p-6 text-center text-amber-800">
                            <AlertTriangle className="mx-auto mb-2 h-8 w-8 opacity-40" />
                            <p>Audience preview is stale. Calculate a fresh preview before launching.</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex gap-4">
                              <Button 
                                type="button" 
                                onClick={() => {
                                  setLaunchMode("live");
                                  setLaunchDialogOpen(true);
                                }} 
                                className="flex-1"
                              >
                                <Play className="mr-2 h-4 w-4" />
                                Launch Now
                              </Button>
                              <Button 
                                type="button" 
                                variant="outline" 
                                onClick={() => {
                                  setLaunchMode("scheduled");
                                  setLaunchDialogOpen(true);
                                }} 
                                className="flex-1"
                              >
                                <Calendar className="mr-2 h-4 w-4" />
                                Schedule Launch
                              </Button>
                            </div>
                            <p className="text-xs text-slate-500 text-center">
                              Launch requests require final confirmation of audience counts.
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="md:col-span-2">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-600" /> Compliance Safeguards</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4 text-sm">
                        <div className="rounded-lg border bg-slate-50 px-3 py-2 font-medium text-slate-700">
                          Approval attachment: {selectedFlyer?.name || "none"}
                        </div>
                        <div className="space-y-2 mb-4">
                          {safeguards.map((item) => <p key={item} className="flex gap-2 text-slate-600"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />{item}</p>)}
                        </div>

                        {!isFinancingCampaign && campaign.status === "draft" && (
                          <div className="rounded-lg bg-amber-50 p-4 border border-amber-200 mt-4">
                            <div className="flex items-center space-x-2">
                              <Checkbox 
                                id="affirm-claims-basic" 
                                checked={claimsAffirmed}
                                onCheckedChange={(c) => setClaimsAffirmed(!!c)}
                              />
                              <Label htmlFor="affirm-claims-basic" className="text-sm font-medium leading-none text-amber-900">
                                I affirm this campaign meets all compliance requirements and is approved for launch.
                              </Label>
                            </div>
                          </div>
                        )}

                        {isFinancingCampaign && (
                          <div className="rounded-lg bg-amber-50 p-4 border border-amber-200">
                            <h4 className="font-semibold text-amber-900 mb-3 flex items-center gap-2">
                              <AlertTriangle className="h-4 w-4" />
                              Launch approvals required
                            </h4>
                            <ul className="list-disc pl-5 space-y-2 text-amber-800 mb-4">
                              <li>Approve the $10K–$5MM range, “as little as 24 hours,” and “bank statements alone” claims.</li>
                              <li>Approve eligible equipment/soft-cost language and confirm the intended audience has valid channel consent.</li>
                              <li>Approve final sender, launch date/time, and controlled first batch.</li>
                            </ul>
                            {campaign.status === "draft" && (
                              <div className="flex items-center space-x-2 pt-2 border-t border-amber-200/50">
                                <Checkbox 
                                  id="affirm-claims" 
                                  checked={claimsAffirmed}
                                  onCheckedChange={(c) => setClaimsAffirmed(!!c)}
                                />
                                <Label htmlFor="affirm-claims" className="text-sm font-medium leading-none text-amber-900">
                                  I affirm these claims are accurate and approved for this audience. (Recorded by server)
                                </Label>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    
                    {isFinancingCampaign && (
                      <Card className="md:col-span-2">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2"><ImageIcon className="h-4 w-4 text-blue-600" /> Reusable Collateral</CardTitle>
                          <CardDescription>Assets associated with this campaign.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                          {[
                            ["Working Capital — Take on the Job", `${getApiBaseUrl()}/collateral/campaign-assets/working-capital`],
                            ["Equipment Financing — The Next Piece of Your Business", `${getApiBaseUrl()}/collateral/campaign-assets/equipment-financing`],
                          ].map(([title, src]) => (
                            <figure key={title} className="overflow-hidden rounded-lg border bg-white">
                              <img src={src} alt={title} className="aspect-[2/3] w-full object-contain" />
                              <figcaption className="flex items-center justify-between gap-3 border-t bg-slate-50 p-3 text-sm font-medium">
                                <span className="truncate">{title}</span>
                                <a href={`${src}/download`} className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
                                  <Download className="h-3.5 w-3.5" />PNG
                                </a>
                              </figcaption>
                            </figure>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="results" className="space-y-6">
                  {results && results.launches.length > 0 ? (
                    <Card>
                      <CardHeader>
                        <CardTitle>Campaign Results</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-4 mb-6">
                          <div className="rounded-lg border bg-slate-50 p-4 text-center">
                            <div className="text-3xl font-bold text-slate-900">{results.counts.eligible}</div>
                            <div className="text-xs text-slate-500 font-medium uppercase mt-1">Eligible</div>
                          </div>
                          <div className="rounded-lg border bg-slate-50 p-4 text-center">
                            <div className="text-3xl font-bold text-slate-900">{results.counts.sent}</div>
                            <div className="text-xs text-slate-500 font-medium uppercase mt-1">Sent</div>
                          </div>
                          <div className="rounded-lg border bg-slate-50 p-4 text-center">
                            <div className="text-3xl font-bold text-red-600">{results.counts.failed}</div>
                            <div className="text-xs text-red-500 font-medium uppercase mt-1">Failed</div>
                          </div>
                          <div className="rounded-lg border bg-slate-50 p-4 text-center">
                            <div className="text-3xl font-bold text-slate-900">{results.counts.excluded}</div>
                            <div className="text-xs text-slate-500 font-medium uppercase mt-1">Excluded</div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h3 className="font-semibold text-slate-800">Launch History</h3>
                          {results.launches.length === 0 ? (
                            <p className="text-sm text-slate-500">No launches recorded yet.</p>
                          ) : (
                            <div className="border rounded-lg overflow-hidden">
                              <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-600 border-b">
                                  <tr>
                                    <th className="px-4 py-3 font-medium">Date</th>
                                    <th className="px-4 py-3 font-medium">Mode</th>
                                    <th className="px-4 py-3 font-medium">Status</th>
                                    <th className="px-4 py-3 font-medium">Sent</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {results.launches.map((l) => (
                                    <tr key={l.id} className="hover:bg-slate-50">
                                      <td className="px-4 py-3 whitespace-nowrap">{new Date(l.createdAt).toLocaleDateString()}</td>
                                      <td className="px-4 py-3"><Badge variant="outline">{l.mode}</Badge></td>
                                      <td className="px-4 py-3 capitalize">{l.status}</td>
                                      <td className="px-4 py-3">{l.sentCount}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 border rounded-lg bg-white border-dashed">
                      <BarChart3 className="mb-4 h-12 w-12 text-slate-300" />
                      <h3 className="text-lg font-medium text-slate-900">No Results Available</h3>
                      <p className="text-sm">Results will appear here after the campaign is launched.</p>
                    </div>
                  )}
                </TabsContent>
              </form>
            </Form>
          </Tabs>
        </div>
      </div>

      <Dialog open={launchDialogOpen} onOpenChange={setLaunchDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Launch</DialogTitle>
            <DialogDescription>
              Review the exact audience counts and details before {launchMode === "live" ? "launching" : "scheduling"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border p-4 space-y-3 bg-slate-50">
              <div className="grid grid-cols-2 gap-4 border-b pb-3">
                <div>
                  <div className="text-xs text-slate-500 font-semibold uppercase">Channel</div>
                  <div className="text-sm font-medium">{form.watch("channel").replace("_", " & ").toUpperCase()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 font-semibold uppercase">Template</div>
                  <div className="text-sm font-medium truncate" title={selectedTemplate?.name || "Custom SMS"}>
                    {selectedTemplate?.name || "Custom SMS"}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2 text-center pt-2">
                <div>
                  <div className="text-xl font-bold text-slate-900">{previewAudience.data?.counts?.eligible || 0}</div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Eligible</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-900">{previewAudience.data?.counts?.excluded || 0}</div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Excluded</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-slate-900">{previewAudience.data?.counts?.emailCapacityRemaining || 0}</div>
                  <div className="text-[10px] text-slate-500 font-semibold uppercase">Capacity Left</div>
                </div>
              </div>
            </div>

            {launchMode === "scheduled" && (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Scheduled Launch Time</Label>
                <Input 
                  id="scheduledAt" 
                  type="datetime-local" 
                  value={scheduledAt} 
                  onChange={e => setScheduledAt(e.target.value)} 
                />
                <p className="text-xs text-amber-600 font-medium">
                  Warning: The scheduled time is saved, but no automatic worker will deliver this campaign yet.
                </p>
              </div>
            )}
            
            <div className="rounded border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>You are about to request a <strong>{launchMode === "live" ? "LIVE LAUNCH" : "SCHEDULED LAUNCH"}</strong>. This action cannot be easily undone once delivery begins.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLaunchDialogOpen(false)}>Cancel</Button>
            <Button onClick={confirmLaunch} disabled={launchCampaign.isPending}>
              {launchCampaign.isPending ? "Submitting..." : `Confirm & ${launchMode === "live" ? "Launch" : "Schedule"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
