import { useState, useEffect } from "react";
import { useGetMe, getGetMeQueryKey, useListUsers, getListUsersQueryKey, useUpdateUser, useUpdateMyMobile, useGetLeadDistributionSettings, getGetLeadDistributionSettingsQueryKey, useUpdateLeadDistributionSettings, getListLeadsQueryKey, useReassignSeededDeals, useBackfillSlugs, useSeedStarterEmail, useSeedNewLenders, useRunProductionCloseout, getListDealsQueryKey, getGetDealsAnalyticsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserRole, UserUpdateRole, type RoutingSettingsMode } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getUserDisplayName } from "@/lib/utils";
import { ShieldAlert, Phone, Building2, Globe, Wrench } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Switch } from "@/components/ui/switch";
import { formatLenderSeedError, formatLenderSeedSummary, formatProductionCloseoutResults } from "@/lib/productionCloseoutSummary";
import { RAY_IDENTITY_REQUEST } from "@/lib/repChooser";
import { getApiBaseUrl } from "@/lib/apiBase";

export default function Settings() {
  const { data: me, isLoading: loadingMe } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: users, isLoading: loadingUsers } = useListUsers({}, { query: { queryKey: getListUsersQueryKey() } });
  const updateUser = useUpdateUser();
  const updateMobile = useUpdateMyMobile();
  const isAdmin = me?.role === UserRole.admin;
  const { data: leadDistribution, isLoading: loadingLeadDistribution } = useGetLeadDistributionSettings({
    query: {
      queryKey: getGetLeadDistributionSettingsQueryKey(),
      enabled: isAdmin,
    },
  });
  const updateLeadDistribution = useUpdateLeadDistributionSettings();
  const reassignSeededDeals = useReassignSeededDeals();
  const backfillSlugs = useBackfillSlugs();
  const seedStarterEmail = useSeedStarterEmail();
  const seedNewLenders = useSeedNewLenders();
  const productionCloseout = useRunProductionCloseout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [mobileInput, setMobileInput] = useState<string>("");
  const [mobileEditing, setMobileEditing] = useState(false);
  const [editingSlug, setEditingSlug] = useState<number | null>(null);
  const [slugInput, setSlugInput] = useState("");
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [routingStaleDaysInput, setRoutingStaleDaysInput] = useState("7");
  const [routingMode, setRoutingMode] = useState<RoutingSettingsMode>("manual");
  const [autoReassignStale, setAutoReassignStale] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergePending, setMergePending] = useState(false);

  const apiBase = getApiBaseUrl();

  const [companyForm, setCompanyForm] = useState({
    companyName: "", companyEmail: "", companyPhone: "", companyWebsite: "",
    companyAddress: "", companyCity: "", companyState: "", companyZip: "",
  });
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [emailSendingEnabled, setEmailSendingEnabled] = useState(false);
  const [bulkEmailPerMinute, setBulkEmailPerMinute] = useState("60");
  const [bulkEmailPerDay, setBulkEmailPerDay] = useState("75");
  const [savingEmailSettings, setSavingEmailSettings] = useState(false);
  const [partnerTextingEnabled, setPartnerTextingEnabled] = useState(true);
  const [savingPartnerTexting, setSavingPartnerTexting] = useState(false);
  const [sendGridTestAddress, setSendGridTestAddress] = useState("");
  const [sendingSendGridTest, setSendingSendGridTest] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<{
    applied: string[];
    detected: string[];
    skipped: string[];
    pending: string[];
    mismatches: Array<{ name: string; expected: string; actual: string }>;
    failed: { name: string; error: string } | null;
    migrations: Array<{ name: string; status: string; detectedAsApplied?: boolean }>;
  } | null>(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  useEffect(() => {
    if (me?.role !== "admin") return;
    setLoadingCompany(true);
    fetch(`${apiBase}/settings/company`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string | number | boolean | null>) => {
        const text = (key: string) => typeof data[key] === "string" ? data[key] as string : "";
        setEmailSendingEnabled(data.emailSendingEnabled === true);
        setBulkEmailPerMinute(String(data.bulkEmailPerMinute ?? 60));
        setBulkEmailPerDay(String(data.bulkEmailPerDay ?? 75));
        return setCompanyForm({
        companyName: text("companyName"),
        companyEmail: text("companyEmail"),
        companyPhone: text("companyPhone"),
        companyWebsite: text("companyWebsite"),
        companyAddress: text("companyAddress"),
        companyCity: text("companyCity"),
        companyState: text("companyState"),
        companyZip: text("companyZip"),
        });
      })
      .catch(() => {})
      .finally(() => setLoadingCompany(false));
    fetch(`${apiBase}/settings/partner-texting`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error("Unable to load partner texting setting")))
      .then((data: { enabled?: boolean }) => setPartnerTextingEnabled(data.enabled !== false))
      .catch(() => {});
  }, [me]);

  const savePartnerTexting = async (enabled: boolean) => {
    setPartnerTextingEnabled(enabled);
    setSavingPartnerTexting(true);
    try {
      const response = await fetch(`${apiBase}/settings/partner-texting`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Unable to save partner texting setting");
      toast({ title: enabled ? "Partner texting enabled" : "Partner texting disabled" });
    } catch (error) {
      setPartnerTextingEnabled(!enabled);
      toast({ title: "Could not save partner texting setting", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSavingPartnerTexting(false);
    }
  };

  const loadMigrationStatus = async () => {
    if (!isAdmin) return;
    try {
      const response = await fetch(`${apiBase}/admin/migrations/status`, { credentials: "include" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to read migration status.");
      setMigrationStatus(payload);
      setMigrationError(null);
    } catch (error) {
      setMigrationError(error instanceof Error ? error.message : "Unable to read migration status.");
    }
  };

  useEffect(() => {
    void loadMigrationStatus();
  }, [isAdmin]);

  const applyPendingMigrations = async () => {
    setMigrationLoading(true);
    setMigrationError(null);
    try {
      const response = await fetch(`${apiBase}/admin/migrations/apply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to apply migrations.");
      setMigrationStatus(payload);
    } catch (error) {
      setMigrationError(error instanceof Error ? error.message : "Unable to apply migrations.");
    } finally {
      setMigrationLoading(false);
    }
  };

  const handleSaveCompany = async () => {
    setSavingCompany(true);
    try {
      const res = await fetch(`${apiBase}/settings/company`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(companyForm),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Company settings saved" });
    } catch {
      toast({ title: "Failed to save company settings", variant: "destructive" });
    } finally {
      setSavingCompany(false);
    }
  };

  const handleSaveEmailSettings = async () => {
    const cap = Number(bulkEmailPerMinute);
    const dayCap = Number(bulkEmailPerDay);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1000) {
      toast({ title: "Invalid bulk cap", description: "Enter a whole number from 1 to 1000 emails per minute.", variant: "destructive" });
      return;
    }
    if (!Number.isInteger(dayCap) || dayCap < 1 || dayCap > 100000) {
      toast({ title: "Invalid daily cap", description: "Enter a whole number from 1 to 100000 emails per day.", variant: "destructive" });
      return;
    }
    setSavingEmailSettings(true);
    try {
      const res = await fetch(`${apiBase}/settings/email-delivery`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ emailSendingEnabled, bulkEmailPerMinute: cap, bulkEmailPerDay: dayCap }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setEmailSendingEnabled(data.emailSendingEnabled === true);
      setBulkEmailPerMinute(String(data.bulkEmailPerMinute ?? cap));
        setBulkEmailPerDay(String(data.bulkEmailPerDay ?? dayCap));
      toast({ title: "Email delivery settings saved" });
    } catch {
      toast({ title: "Failed to save email delivery settings", variant: "destructive" });
    } finally {
      setSavingEmailSettings(false);
    }
  };

  const handleSendGridTest = async () => {
    const toEmail = sendGridTestAddress.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      toast({ title: "Enter a valid test email address", variant: "destructive" });
      return;
    }
    setSendingSendGridTest(true);
    try {
      const response = await fetch(`${apiBase}/email/test-send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to send SendGrid test email.");
      toast({
        title: "SendGrid test email queued",
        description: `Message ID: ${payload.messageId || "not returned by provider"}`,
      });
    } catch (error) {
      toast({ title: "SendGrid test failed", description: error instanceof Error ? error.message : "Unable to send test email.", variant: "destructive" });
    } finally {
      setSendingSendGridTest(false);
    }
  };

  const handleRoleChange = (userId: number, newRole: UserUpdateRole) => {
    updateUser.mutate({ id: userId, data: { role: newRole } }, {
      onSuccess: () => {
        toast({ title: "Role Updated", description: "User role has been updated." });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update user role.", variant: "destructive" });
      }
    });
  };

  const mergeUsers = async (confirmReassignment = false) => {
    const sourceUserId = Number(mergeSourceId);
    const targetUserId = Number(mergeTargetId);
    if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) {
      toast({ title: "Choose different source and target users", variant: "destructive" });
      return;
    }
    setMergePending(true);
    try {
      const response = await fetch(`${apiBase}/admin/users/merge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUserId, targetUserId, confirmReassignment }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.code === "CONFIRM_REASSIGNMENT_REQUIRED") {
        const confirmed = window.confirm(
          "This pending user owns records. Reassign all of its leads, deals, notes, tasks, documents, activity, submissions, collateral, and history to the target?",
        );
        if (confirmed) return await mergeUsers(true);
        return;
      }
      if (!response.ok) throw new Error(payload.error || "Unable to merge users");
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      setMergeSourceId("");
      setMergeTargetId("");
      toast({ title: "Users merged", description: `${payload.reassigned ?? 0} records reassigned.` });
    } catch (error) {
      toast({ title: "Unable to merge users", description: error instanceof Error ? error.message : "Merge failed", variant: "destructive" });
    } finally {
      setMergePending(false);
    }
  };

  const downloadQr = async (slug: string, format: "png" | "svg") => {
    const url = `https://app.my-business-solutions.com/r/${slug}`;
    const options = { width: 1000, margin: 4, color: { dark: "#0E2A47", light: "#FFFFFF" } };
    if (format === "png") {
      const dataUrl = await QRCode.toDataURL(url, options);
      const a = document.createElement("a"); a.href = dataUrl; a.download = `${slug}-qr.png`; a.click();
    } else {
      const svg = await QRCode.toString(url, { ...options, type: "svg" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      a.download = `${slug}-qr.svg`; a.click(); URL.revokeObjectURL(a.href);
    }
  };

  const saveSlug = async (userId: number) => {
    const slug = slugInput.trim().toLowerCase();
    const existing = users?.find((user) => user.id === userId);
    if (existing?.slug) {
      try {
        const response = await fetch(`${apiBase}/admin/users/${userId}/retire-slug`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            existing.email.trim().toLowerCase() === "rahmaredavis@gmail.com"
              || existing.email.trim().toLowerCase() === "ray@my-business-solutions.com"
              ? RAY_IDENTITY_REQUEST
              : { newSlug: slug },
          ),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "This link may already be in use.");
        setEditingSlug(null);
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "Rep link updated", description: `/${existing.slug} now redirects permanently.` });
      } catch (error: any) {
        toast({ title: "Unable to update link", description: error?.message || "This link may already be in use or retired.", variant: "destructive" });
      }
      return;
    }
    updateUser.mutate({ id: userId, data: { slug } }, {
      onSuccess: () => { setEditingSlug(null); queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); toast({ title: "Rep link updated" }); },
      onError: (error: any) => toast({ title: "Unable to update link", description: error?.message || "This link may already be in use or locked.", variant: "destructive" }),
    });
  };

  const saveTitle = (userId: number) => {
    updateUser.mutate(
      { id: userId, data: { title: titleInput.trim() || null } },
      {
        onSuccess: () => {
          setEditingTitle(null);
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "Title updated" });
        },
        onError: () => toast({ title: "Unable to update title", variant: "destructive" }),
      },
    );
  };

  const saveRayIdentity = async (userId: number) => {
    try {
      const response = await fetch(`${apiBase}/admin/users/${userId}/retire-slug`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(RAY_IDENTITY_REQUEST),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "This slug may already be in use.");
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "Ray identity updated", description: "The canonical Ray Davis link is now /r/ray." });
    } catch (error: any) {
      toast({ title: "Unable to update Ray identity", description: error?.message || "This slug may already be in use.", variant: "destructive" });
    }
  };

  const handleEditMobile = () => {
    setMobileInput(me?.mobileNumber ?? "");
    setMobileEditing(true);
  };

  const handleSaveMobile = () => {
    updateMobile.mutate(
      { data: { mobileNumber: mobileInput.trim() || null } },
      {
        onSuccess: () => {
          toast({ title: "Saved", description: "Call forwarding number updated." });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          setMobileEditing(false);
        },
        onError: () => toast({ title: "Error", description: "Failed to save mobile number.", variant: "destructive" }),
      }
    );
  };

  useEffect(() => {
    if (leadDistribution?.routing) {
      setRoutingMode(leadDistribution.routing.mode);
      setRoutingStaleDaysInput(String(leadDistribution.routing.staleDays));
      setAutoReassignStale(leadDistribution.routing.autoReassignStale);
    }
  }, [leadDistribution?.routing]);

  const handleSaveRouting = () => {
    const staleDays = Number(routingStaleDaysInput);
    if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 365) {
      toast({ title: "Invalid threshold", description: "Enter a whole number from 1 to 365 days.", variant: "destructive" });
      return;
    }
    updateLeadDistribution.mutate(
      { data: { routing: { mode: routingMode, staleDays, autoReassignStale } } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetLeadDistributionSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          toast({ title: "Routing settings saved" });
        },
        onError: () => toast({ title: "Error", description: "Failed to save routing settings.", variant: "destructive" }),
      },
    );
  };

  const handleReassignSeededDeals = () => {
    if (!window.confirm("Move 21 ordinary seeded deals to Nate Ford, clear temporary ownership from four Calvin deals while preserving their markers, and verify Arslan has zero deals?")) return;
    reassignSeededDeals.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDealsAnalyticsQueryKey() });
        toast({
          title: "Seeded deal ownership corrected",
          description: `${result.ordinaryChanged} moved this run; ${result.ordinaryAtNate} ordinary deals at Nate Ford. ${result.calvinCleared} Calvin deals cleared this run; ${result.calvinReservedUnassigned} unassigned with markers preserved. Arslan has ${result.arslanTotalDeals} deals.`,
        });
      },
      onError: (error: any) => toast({
        title: "Unable to correct seeded ownership",
        description: error?.message || "The required user safety checks failed.",
        variant: "destructive",
      }),
    });
  };

  const handleBackfillSlugs = () => {
    if (!window.confirm("Backfill the three production representative links (Arslan, Arslan duplicate, and Nate) only when the safety checks pass?")) return;
    backfillSlugs.reset();
    backfillSlugs.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Representative links checked",
          description: `${result.changed} link${result.changed === 1 ? "" : "s"} updated; ${result.unchanged} already matched.`,
        });
      },
    });
  };

  const handleSeedStarterEmail = () => {
    if (!window.confirm("Create any missing starter email templates and the inactive New Application Nurture sequence? Existing templates will not be duplicated.")) return;
    seedStarterEmail.reset();
    seedStarterEmail.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Starter email data checked",
          description: `${result.templatesCreated} template${result.templatesCreated === 1 ? "" : "s"} created; ${result.sequenceCreated ? "nurture sequence created" : "nurture sequence already existed"}.`,
        });
      },
    });
  };

  const handleSeedNewLenders = () => {
    if (!window.confirm("Create any missing configured lenders, then apply the pending packet updates to exact-name existing lenders? Repeating this action is safe: marked updates and existing seeds remain unchanged.")) return;
    seedNewLenders.reset();
    seedNewLenders.mutate(undefined, {
      onSuccess: (result) => {
        toast({
          title: "Lender seed/update checked",
          description: formatLenderSeedSummary(result),
        });
      },
      onError: (error) => {
        toast({
          title: "Lender seed/update failed",
          description: formatLenderSeedError(error),
          variant: "destructive",
        });
      },
    });
  };

  const handleProductionCloseout = () => {
    if (!window.confirm("Run production closeout in order: ownership correction, slug backfill, starter email/template seed, then configured lender creation and packet updates? Each completed operation remains committed if a later operation fails.")) return;
    productionCloseout.reset();
    productionCloseout.mutate(undefined, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({
          title: result.overallStatus === "succeeded" ? "Production closeout complete" : "Production closeout stopped",
          description: result.overallStatus === "succeeded" ? "All four operations completed in order." : "Review the ordered results below and use an individual fallback if needed.",
          variant: result.overallStatus === "succeeded" ? "default" : "destructive",
        });
      },
    });
  };

  return (
    <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
        <p className="text-muted-foreground mt-0.5 text-sm">Manage your account and organization settings.</p>
      </div>

      <div className="grid gap-8">
        <Card>
          <CardHeader>
            <CardTitle>My Profile</CardTitle>
            <CardDescription>Your personal account information.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMe ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-[250px]" />
                <Skeleton className="h-4 w-[200px]" />
              </div>
            ) : me ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
                  <div className="font-medium">{getUserDisplayName(me, "N/A")}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                  <div className="font-medium">{me.email}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Role</div>
                  <Badge variant="outline" className="capitalize">{me.role}</Badge>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Member Since</div>
                  <div className="font-medium">{format(new Date(me.createdAt), 'MMM d, yyyy')}</div>
                </div>
                {me.slug && (
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Your application link:</span>
                    <span className="font-mono text-sm">/r/{me.slug}</span>
                    <Button size="sm" variant="outline" onClick={() => downloadQr(me.slug!, "png")}>Download QR PNG</Button>
                    <Button size="sm" variant="outline" onClick={() => downloadQr(me.slug!, "svg")}>Download QR SVG</Button>
                  </div>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Call Forwarding */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-[#1F4E79]" />
              Call Forwarding
            </CardTitle>
            <CardDescription>
              When your browser is offline, inbound calls will simultaneously ring this mobile number.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMe ? (
              <Skeleton className="h-10 w-[280px]" />
            ) : mobileEditing ? (
              <div className="flex items-center gap-3 max-w-sm">
                <Input
                  type="tel"
                  value={mobileInput}
                  onChange={(e) => setMobileInput(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  className="font-mono"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveMobile(); if (e.key === "Escape") setMobileEditing(false); }}
                  autoFocus
                />
                <Button onClick={handleSaveMobile} disabled={updateMobile.isPending} size="sm" className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                  {updateMobile.isPending ? "Saving…" : "Save"}
                </Button>
                <Button onClick={() => setMobileEditing(false)} variant="ghost" size="sm">Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="text-sm font-mono font-medium">
                  {me?.mobileNumber || <span className="text-muted-foreground">Not configured</span>}
                </div>
                <Button variant="outline" size="sm" onClick={handleEditMobile}>
                  {me?.mobileNumber ? "Change" : "Add number"}
                </Button>
                {me?.mobileNumber && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700"
                    onClick={() => updateMobile.mutate({ data: { mobileNumber: null } }, {
                      onSuccess: () => {
                        toast({ title: "Removed", description: "Call forwarding number removed." });
                        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
                      }
                    })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Email Delivery Safety</CardTitle>
              <CardDescription>
                Sending is disabled by default. Enable it only after SendGrid credentials and compliance settings are verified.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl">
                <div>
                  <div className="font-medium">Allow outbound email</div>
                  <div className="text-sm text-muted-foreground">
                    Applies to individual, bulk, drip, and test sends. Disabled sends are recorded as failed and are never delivered.
                  </div>
                </div>
                <Switch
                  checked={emailSendingEnabled}
                  disabled={savingEmailSettings}
                  onCheckedChange={setEmailSendingEnabled}
                  aria-label="Allow outbound email"
                />
              </div>
              <div className="flex flex-wrap items-end justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Bulk email rate cap</div>
                  <div className="text-sm text-muted-foreground">Maximum messages per minute for each bulk request (1–1000).</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={bulkEmailPerMinute}
                    onChange={(event) => setBulkEmailPerMinute(event.target.value)}
                    className="w-24"
                    aria-label="Bulk emails per minute"
                  />
                  <span className="text-sm text-muted-foreground">per minute</span>
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-4 max-w-2xl mt-5">
                <div>
                  <div className="font-medium">Bulk and drip daily allowance</div>
                  <div className="text-sm text-muted-foreground">Shared daily ceiling for bulk and automated drip delivery attempts (1–100000).</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    max={100000}
                    value={bulkEmailPerDay}
                    onChange={(event) => setBulkEmailPerDay(event.target.value)}
                    className="w-28"
                    aria-label="Bulk and drip emails per day"
                  />
                  <span className="text-sm text-muted-foreground">per day</span>
                </div>
              </div>
              <Button onClick={handleSaveEmailSettings} disabled={savingEmailSettings} className="mt-5 bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                {savingEmailSettings ? "Saving…" : "Save Email Safety Settings"}
              </Button>
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Allow partner texting</div>
                  <div className="text-sm text-muted-foreground">Business-contact SMS bypasses consumer consent, but STOP and A2P provider safeguards still apply.</div>
                </div>
                <Switch checked={partnerTextingEnabled} disabled={savingPartnerTexting} onCheckedChange={(checked) => void savePartnerTexting(checked)} aria-label="Allow partner texting" />
              </div>
              <div className="mt-6 max-w-2xl border-t pt-5">
                <div className="font-medium">Send SendGrid test email</div>
                <p className="mt-1 text-sm text-muted-foreground">Sends the CEO delivery-test template from funding@my-business-solutions.com to the typed address. The provider message ID is shown after delivery is accepted.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input
                    type="email"
                    value={sendGridTestAddress}
                    onChange={(event) => setSendGridTestAddress(event.target.value)}
                    placeholder="you@example.com"
                    aria-label="SendGrid test recipient"
                    className="max-w-sm"
                  />
                  <Button onClick={handleSendGridTest} disabled={sendingSendGridTest} variant="outline">
                    {sendingSendGridTest ? "Sending…" : "Send test email"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Lead Distribution</CardTitle>
              <CardDescription>
                Choose manual assignment or round-robin for ordinary inbound website leads. QR-card and prospect-list leads are never round-robin assigned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 max-w-2xl">
                <div>
                  <div className="font-medium">Assignment mode</div>
                  <div className="text-sm text-muted-foreground">
                    Manual leaves new ordinary inbound leads unassigned. Round-robin assigns them across eligible active users.
                  </div>
                </div>
                <Select value={routingMode} onValueChange={(value) => setRoutingMode(value as RoutingSettingsMode)}>
                  <SelectTrigger className="w-44" data-testid="select-routing-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="round_robin">Round robin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Include admins in round-robin</div>
                  <div className="text-sm text-muted-foreground">
                    When enabled, active admins join the same pool as active reps and managers. Pending and inactive users are never eligible.
                  </div>
                </div>
                <Switch
                  checked={leadDistribution?.includeAdminsInRoundRobin ?? false}
                  disabled={loadingLeadDistribution || updateLeadDistribution.isPending}
                  onCheckedChange={(checked) => updateLeadDistribution.mutate(
                    { data: { includeAdminsInRoundRobin: checked } },
                    {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getGetLeadDistributionSettingsQueryKey() });
                        toast({ title: "Lead distribution setting saved" });
                      },
                      onError: () => toast({ title: "Error", description: "Failed to save lead distribution setting.", variant: "destructive" }),
                    },
                  )}
                  aria-label="Include admins in round-robin"
                  data-testid="switch-include-admins-round-robin"
                />
              </div>
              <div className="flex items-end justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Stale lead threshold</div>
                  <div className="text-sm text-muted-foreground">
                    Assigned leads with no activity for this many days are shown in the stale queue. Unassigned leads are never stale.
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={routingStaleDaysInput}
                    onChange={(event) => setRoutingStaleDaysInput(event.target.value)}
                    className="w-24"
                    aria-label="Stale lead threshold in days"
                    data-testid="input-routing-stale-days"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Automatically reassign stale inbound leads</div>
                  <div className="text-sm text-muted-foreground">
                    Requires round-robin mode. Every automated reassignment records the former and new representative.
                  </div>
                </div>
                <Switch
                  checked={autoReassignStale}
                  onCheckedChange={setAutoReassignStale}
                  disabled={routingMode !== "round_robin" || updateLeadDistribution.isPending}
                  aria-label="Automatically reassign stale inbound leads"
                  data-testid="switch-auto-reassign-stale"
                />
              </div>
              <Button className="mt-6" onClick={handleSaveRouting} disabled={updateLeadDistribution.isPending} data-testid="button-save-routing-settings">
                Save routing settings
              </Button>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-[#1F4E79]" />
                Data Maintenance
              </CardTitle>
              <CardDescription>Run narrowly scoped, admin-only maintenance actions for seeded CRM data.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-amber-600/30 bg-amber-50/60 p-4 max-w-2xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-medium">Schema migrations</h3>
                    <div className="text-sm text-muted-foreground">
                      Apply numbered, checksum-verified migrations one at a time. Existing schema changes are detected safely and are not replayed.
                    </div>
                  </div>
                  <Button onClick={applyPendingMigrations} disabled={migrationLoading} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                    {migrationLoading ? "Applying migrations…" : "Apply pending migrations"}
                  </Button>
                </div>
                {migrationError && (
                  <p className="mt-3 text-sm text-destructive" role="alert">{migrationError}</p>
                )}
                {migrationStatus && (
                  <div className="mt-4 space-y-1 border-t pt-3 text-sm" aria-live="polite">
                    <div className="font-medium">
                      {migrationStatus.pending.length === 0 ? "Schema is up to date" : `${migrationStatus.pending.length} migration${migrationStatus.pending.length === 1 ? "" : "s"} pending`}
                    </div>
                    {migrationStatus.applied.length > 0 && <div className="text-muted-foreground">Applied now: {migrationStatus.applied.join(", ")}</div>}
                    {migrationStatus.detected.length > 0 && <div className="text-muted-foreground">Detected already applied: {migrationStatus.detected.join(", ")}</div>}
                    {migrationStatus.pending.length > 0 && <div className="text-amber-700">Pending: {migrationStatus.pending.join(", ")}</div>}
                    {migrationStatus.mismatches.length > 0 && <div className="text-destructive">Checksum mismatch: {migrationStatus.mismatches.map((item) => item.name).join(", ")}</div>}
                    {migrationStatus.failed && <div className="text-destructive">Failed: {migrationStatus.failed.name} — {migrationStatus.failed.error}</div>}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-[#1F4E79]/30 bg-[#1F4E79]/5 p-4 max-w-2xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="font-medium">Production closeout</h3>
                    <div className="text-sm text-muted-foreground">
                       Runs ownership correction, slug backfill, starter email/template seed, and configured lender creation/packet updates in that exact order. Each operation has its own transaction; a later failure stops the sequence but does not roll back earlier successful operations.
                    </div>
                  </div>
                  <Button onClick={handleProductionCloseout} disabled={productionCloseout.isPending} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                    {productionCloseout.isPending ? "Running production closeout…" : "Run production closeout"}
                  </Button>
                </div>
                {productionCloseout.error && (
                  <p className="mt-3 text-sm text-destructive" role="alert">
                    {productionCloseout.error.message || "Unable to run production closeout."}
                  </p>
                )}
                {productionCloseout.data && (
                  <div className="mt-4 space-y-2 border-t pt-3" aria-live="polite">
                    <div className="text-sm font-medium">
                      Ordered closeout summary — {productionCloseout.data.overallStatus}
                    </div>
                    {formatProductionCloseoutResults(productionCloseout.data.results).map((line) => (
                      <div key={line.operation} className="flex flex-wrap gap-2 text-sm">
                        <span className="font-medium capitalize">{line.label}</span>
                        <span className={line.status === "failed" ? "text-destructive" : line.status === "skipped" ? "text-amber-700" : "text-muted-foreground"}>
                          {line.status}
                        </span>
                        <span className={line.status === "failed" ? "text-destructive" : line.status === "skipped" ? "text-amber-700" : "text-muted-foreground"}>
                          — {line.summary}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-6 border-t pt-5">
                <h3 className="font-medium">Individual fallback actions</h3>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl">
                <div>
                  <div className="font-medium">Correct seeded deal ownership</div>
                  <div className="text-sm text-muted-foreground">
                    Moves 21 ordinary seeded deals to Nate Ford, unassigns four Calvin deals while preserving markers, and verifies Arslan has zero.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleReassignSeededDeals}
                  disabled={reassignSeededDeals.isPending}
                >
                  {reassignSeededDeals.isPending ? "Correcting…" : "Correct ownership"}
                </Button>
              </div>
              {reassignSeededDeals.error && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {reassignSeededDeals.error.message || "Unable to correct seeded ownership."}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Backfill representative links</div>
                  <div className="text-sm text-muted-foreground">
                    Safely applies the three production slugs and stops if a target user or slug check fails.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleBackfillSlugs}
                  disabled={backfillSlugs.isPending}
                >
                  {backfillSlugs.isPending ? "Backfilling…" : "Run slug backfill"}
                </Button>
              </div>
              {backfillSlugs.error && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {backfillSlugs.error.message || "Unable to backfill representative links."}
                </p>
              )}
              {backfillSlugs.data && (
                <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                  Link backfill complete: {backfillSlugs.data.changed} updated, {backfillSlugs.data.unchanged} already matched, across {backfillSlugs.data.users.length} production users.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Seed starter email data</div>
                  <div className="text-sm text-muted-foreground">
                    Creates missing starter templates and the inactive New Application Nurture sequence without duplicating existing data.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSeedStarterEmail}
                  disabled={seedStarterEmail.isPending}
                >
                  {seedStarterEmail.isPending ? "Seeding…" : "Seed email templates"}
                </Button>
              </div>
              {seedStarterEmail.error && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {seedStarterEmail.error.message || "Unable to seed starter email data."}
                </p>
              )}
              {seedStarterEmail.data && (
                <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                  Starter email seed complete: {seedStarterEmail.data.templatesCreated} template{seedStarterEmail.data.templatesCreated === 1 ? "" : "s"} created, {seedStarterEmail.data.skippedTemplates} skipped, and the nurture sequence was {seedStarterEmail.data.sequenceCreated ? "created" : "already present"}.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-4 max-w-2xl mt-6 pt-5 border-t">
                <div>
                  <div className="font-medium">Seed verified lenders</div>
                  <div className="text-sm text-muted-foreground">
                    Creates missing configured lenders and applies the pending packet updates to exact-name existing lenders.
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSeedNewLenders}
                  disabled={seedNewLenders.isPending}
                >
                  Seed new lenders
                </Button>
              </div>
              {seedNewLenders.error && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {seedNewLenders.error.message || "Unable to seed new lenders."}
                </p>
              )}
              {seedNewLenders.data && (
                <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
                  {formatLenderSeedSummary(seedNewLenders.data)}. Full lender records are available in the lender directory.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-[#1F4E79]" />
                Company Settings
              </CardTitle>
              <CardDescription>Contact details and branding for your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCompany ? (
                <div className="space-y-3 max-w-2xl">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Company Name</label>
                    <Input value={companyForm.companyName} onChange={(e) => setCompanyForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="MBS Financial" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Contact Email</label>
                    <Input type="email" value={companyForm.companyEmail} onChange={(e) => setCompanyForm((f) => ({ ...f, companyEmail: e.target.value }))} placeholder="contact@company.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">Phone</label>
                    <Input type="tel" value={companyForm.companyPhone} onChange={(e) => setCompanyForm((f) => ({ ...f, companyPhone: e.target.value }))} placeholder="+1 (800) 000-0000" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> Website</label>
                    <Input type="url" value={companyForm.companyWebsite} onChange={(e) => setCompanyForm((f) => ({ ...f, companyWebsite: e.target.value }))} placeholder="https://company.com" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-sm font-medium text-muted-foreground">Street Address</label>
                    <Input value={companyForm.companyAddress} onChange={(e) => setCompanyForm((f) => ({ ...f, companyAddress: e.target.value }))} placeholder="123 Main St" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-muted-foreground">City</label>
                    <Input value={companyForm.companyCity} onChange={(e) => setCompanyForm((f) => ({ ...f, companyCity: e.target.value }))} placeholder="New York" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">State</label>
                      <Input value={companyForm.companyState} onChange={(e) => setCompanyForm((f) => ({ ...f, companyState: e.target.value }))} placeholder="NY" maxLength={2} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium text-muted-foreground">ZIP</label>
                      <Input value={companyForm.companyZip} onChange={(e) => setCompanyForm((f) => ({ ...f, companyZip: e.target.value }))} placeholder="10001" maxLength={10} />
                    </div>
                  </div>
                  <div className="sm:col-span-2 pt-2">
                    <Button onClick={handleSaveCompany} disabled={savingCompany} className="bg-[#1F4E79] hover:bg-[#163a5f] text-white">
                      {savingCompany ? "Saving…" : "Save Company Settings"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>User Management</CardTitle>
              <CardDescription>Manage user roles within your organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
                <div className="min-w-[190px]">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Stray pending user</label>
                  <Select value={mergeSourceId} onValueChange={setMergeSourceId}>
                    <SelectTrigger><SelectValue placeholder="Choose source" /></SelectTrigger>
                    <SelectContent>
                      {(users ?? []).filter((user) => user.role === UserRole.pending && user.isActive).map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>{getUserDisplayName(user, user.email)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[190px]">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Real active user</label>
                  <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
                    <SelectTrigger><SelectValue placeholder="Choose target" /></SelectTrigger>
                    <SelectContent>
                      {(users ?? []).filter((user) => user.isActive && user.role !== UserRole.pending).map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>{getUserDisplayName(user, user.email)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" disabled={mergePending || !mergeSourceId || !mergeTargetId} onClick={() => void mergeUsers()}>
                  {mergePending ? "Merging…" : "Merge user"}
                </Button>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Rep link</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Application</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingUsers ? (
                      [...Array(3)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                          <TableCell><Skeleton className="h-8 w-[120px]" /></TableCell>
                        </TableRow>
                      ))
                    ) : users?.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{getUserDisplayName(user)}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          {editingSlug === user.id ? (
                            <div className="flex items-center gap-1">
                              <Input className="h-8 w-32 font-mono text-xs" value={slugInput} onChange={(e) => setSlugInput(e.target.value.toLowerCase())} />
                              <Button size="sm" className="h-8" onClick={() => saveSlug(user.id)} disabled={updateUser.isPending}>Save</Button>
                              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingSlug(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{user.slug ? `/r/${user.slug}` : "—"}</span>
                              {(user.email.trim().toLowerCase() === "rahmaredavis@gmail.com" || user.email.trim().toLowerCase() === "ray@my-business-solutions.com") && user.slug !== "ray" && (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => saveRayIdentity(user.id)}>Set Ray identity</Button>
                              )}
                              {!user.slug && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setEditingSlug(user.id); setSlugInput(""); }}>Set slug</Button>}
                              {user.slug && <><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => downloadQr(user.slug!, "png")}>PNG</Button><Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => downloadQr(user.slug!, "svg")}>SVG</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setEditingSlug(user.id); setSlugInput(user.slug!); }}>Edit</Button></>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{format(new Date(user.createdAt), 'MMM d, yyyy')}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={(val) => handleRoleChange(user.id, val as UserUpdateRole)}
                            disabled={user.id === me?.id || updateUser.isPending}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UserUpdateRole.admin}>Admin</SelectItem>
                              <SelectItem value={UserUpdateRole.manager}>Manager</SelectItem>
                              <SelectItem value={UserUpdateRole.rep}>Rep</SelectItem>
                              <SelectItem value={UserUpdateRole.pending}>Pending</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {editingTitle === user.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                className="h-8 w-44 text-xs"
                                value={titleInput}
                                maxLength={200}
                                onChange={(e) => setTitleInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveTitle(user.id); if (e.key === "Escape") setEditingTitle(null); }}
                                autoFocus
                              />
                              <Button size="sm" className="h-8 text-xs" onClick={() => saveTitle(user.id)} disabled={updateUser.isPending}>Save</Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="max-w-44 truncate text-left text-xs text-muted-foreground hover:text-foreground"
                              title={user.title || "Set title"}
                              onClick={() => { setEditingTitle(user.id); setTitleInput(user.title ?? ""); }}
                            >
                              {user.title || "Set title"}
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          <a
                            href={`${apiBase}/users/${user.id}/application-form.pdf`}
                            className="text-xs font-medium text-[#1F4E79] underline underline-offset-2 whitespace-nowrap"
                          >
                            Download blank PDF
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <ShieldAlert className="h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>You need administrator privileges to manage organizational settings.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
