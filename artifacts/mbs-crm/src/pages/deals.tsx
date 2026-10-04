import { useState, useEffect, useRef } from "react";
import { PipelineSkeleton } from "@/components/page-skeletons";
import { Link } from "wouter";
import {
  useListDeals,
  getListDealsQueryKey,
  useUpdateDeal,
  useSeedDeals,
  useGetMe,
  DealStage,
  Deal,
  ListDealsSortBy,
  ListDealsSortOrder,
  useListUsers,
} from "@workspace/api-client-react";
import { cn, getUserDisplayName } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  LayoutGrid,
  List,
  Plus,
  Download,
  DollarSign,
  Building2,
  User as UserIcon,
  ArrowUpDown,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  type DealView,
  DEAL_STAGE_COLUMNS,
  formatGmDisplay,
  serializeDealViewStages,
  visibleDealTotals,
  KANBAN_COMPACT_GAP,
  KANBAN_COMPACT_COLUMN_MIN_WIDTH,
  kanbanCompactPreferenceKey,
  readKanbanCompactPreference,
} from "@/lib/dealBoard";
import { createNoteSaveController } from "@/lib/noteSaveController";
import { QueryErrorState } from "@/components/query-error-state";
import { contactName, formatDealIdentity } from "@/lib/recordIdentity";
import { EmailLink, PhoneLink } from "@/components/phone-link";
import { useIsDesktop } from "@/hooks/use-desktop-sidebar";

const STAGES = DEAL_STAGE_COLUMNS;

function formatCurrency(val?: number | null) {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);
}

function LastActivity({
  at,
  actor,
}: {
  at?: string | null;
  actor?: { name?: string | null; email?: string } | null;
}) {
  if (!at) return <span>—</span>;
  return (
    <span className="flex flex-col">
      <span>{formatDistanceToNow(new Date(at), { addSuffix: true })}</span>
      <span className="text-xs text-muted-foreground">
        {getUserDisplayName(actor, "System")}
      </span>
    </span>
  );
}

export default function DealsPage() {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<ListDealsSortBy>(
    ListDealsSortBy.updatedAt,
  );
  const [sortOrder, setSortOrder] = useState<ListDealsSortOrder>(
    ListDealsSortOrder.desc,
  );
  const [dealView, setDealView] = useState<DealView>("all");
  const [compactPreference, setCompactPreference] = useState<{
    key: string | null;
    loadedKey: string | null;
    value: boolean;
  }>({ key: null, loadedKey: null, value: true });
  const [isExporting, setIsExporting] = useState(false);

  const { data: currentUser } = useGetMe();
  const isRep = currentUser?.role === "rep";

  const compactPreferenceKey = currentUser?.id
    ? kanbanCompactPreferenceKey(currentUser.id)
    : null;
  const compactKanban =
    compactPreference.loadedKey === compactPreferenceKey &&
    compactPreference.value;

  useEffect(() => {
    if (!compactPreferenceKey) {
      setCompactPreference({ key: null, loadedKey: null, value: true });
      return;
    }
    try {
      setCompactPreference({
        key: compactPreferenceKey,
        loadedKey: compactPreferenceKey,
        value: readKanbanCompactPreference(window.localStorage, compactPreferenceKey),
      });
    } catch {
      // Storage can be unavailable in privacy-restricted browsers.
      setCompactPreference({
        key: compactPreferenceKey,
        loadedKey: compactPreferenceKey,
        value: true,
      });
    }
  }, [compactPreferenceKey]);

  useEffect(() => {
    if (
      !compactPreferenceKey ||
      compactPreference.loadedKey !== compactPreferenceKey
    ) {
      return;
    }
    try {
      window.localStorage.setItem(
        compactPreferenceKey,
        String(compactPreference.value),
      );
    } catch {
      // Storage can be unavailable in privacy-restricted browsers.
    }
  }, [compactPreference, compactPreferenceKey]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const listParams = {
    search: debouncedSearch || undefined,
    stages: serializeDealViewStages(dealView)?.split(",") as any,
    sort_by: sortBy,
    sort_order: sortOrder,
  };
  const { data: response, isLoading, error: dealsError, refetch: refetchDeals } = useListDeals(listParams, {
    query: { queryKey: getListDealsQueryKey(listParams) },
  });
  const deals = response?.deals || [];

  const {
    data: users,
    error: usersError,
    refetch: refetchUsers,
  } = useListUsers();

  const updateDeal = useUpdateDeal();
  const seedDeals = useSeedDeals();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [draggedDeal, setDraggedDeal] = useState<Deal | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const [fundPromptOpen, setFundPromptOpen] = useState(false);
  const [pendingFundDeal, setPendingFundDeal] = useState<Deal | null>(null);
  const [actualGm, setActualGm] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [notePendingId, setNotePendingId] = useState<number | null>(null);
  const [noteErrorId, setNoteErrorId] = useState<number | null>(null);
  const noteSaveController = useRef(createNoteSaveController()).current;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      params.set("sort_by", sortBy);
      params.set("sort_order", sortOrder);
      const serializedStages = serializeDealViewStages(dealView);
      if (serializedStages) params.set("stages", serializedStages);
      const query = params.toString();
      const response = await fetch(
        `/api/deals/export${query ? `?${query}` : ""}`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const contentDisposition =
        response.headers.get("Content-Disposition") ?? "";
      const encodedFilename = contentDisposition.match(
        /filename\*=UTF-8''([^;]+)/i,
      )?.[1];
      const quotedFilename = contentDisposition.match(
        /filename="?([^";]+)"?/i,
      )?.[1];
      const fallbackFilename = `mbs-deals-${new Date().toISOString().slice(0, 10)}.csv`;
      const filename = encodedFilename
        ? decodeURIComponent(encodedFilename)
        : quotedFilename || fallbackFilename;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleActivitySort = () => {
    if (sortBy === ListDealsSortBy.lastActivityAt) {
      setSortOrder((current) =>
        current === ListDealsSortOrder.desc
          ? ListDealsSortOrder.asc
          : ListDealsSortOrder.desc,
      );
    } else {
      setSortBy(ListDealsSortBy.lastActivityAt);
      setSortOrder(ListDealsSortOrder.desc);
    }
  };

  const handleDragStart = (e: React.DragEvent, deal: Deal) => {
    setDraggedDeal(deal);
    e.dataTransfer.setData("text/plain", deal.id.toString());
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverStage !== stage) setDragOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverStage(null);
  };

  const handleDrop = (e: React.DragEvent, stage: string) => {
    e.preventDefault();
    setDragOverStage(null);
    if (!draggedDeal || draggedDeal.stage === stage) return;

    if (stage === DealStage.funded) {
      setPendingFundDeal(draggedDeal);
      setActualGm(draggedDeal.approxGm ? String(draggedDeal.approxGm) : "");
      setFundPromptOpen(true);
    } else {
      mutateDealStage(draggedDeal.id, stage);
    }
  };

  const mutateDealStage = (dealId: number, stage: string, gm?: number) => {
    updateDeal.mutate(
      {
        id: dealId,
        data: { stage: stage as any, ...(gm != null ? { actualGm: gm } : {}) },
      },
      {
        onSuccess: () => {
          toast({ title: "Deal updated" });
          queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        },
        onError: () =>
          toast({ title: "Update failed", variant: "destructive" }),
      },
    );
  };

  const confirmFund = () => {
    if (!pendingFundDeal) return;
    mutateDealStage(pendingFundDeal.id, DealStage.funded, Number(actualGm));
    setFundPromptOpen(false);
    setPendingFundDeal(null);
  };

  const beginNoteEdit = (deal: Deal) => {
    setEditingNoteId(deal.id);
    setNoteDraft(deal.notes ?? "");
    setNoteErrorId(null);
  };

  const saveNote = (deal: Deal) => {
    if (editingNoteId !== deal.id || notePendingId === deal.id) return;
    if (noteDraft === (deal.notes ?? "")) {
      setEditingNoteId(null);
      return;
    }
    if (noteSaveController.isInFlight(deal.id)) return;
    setNoteErrorId(null);
    setNotePendingId(deal.id);
    noteSaveController.save(
      deal.id,
      deal.notes ?? "",
      noteDraft,
      () =>
        new Promise<void>((resolve, reject) => {
          updateDeal.mutate(
            { id: deal.id, data: { notes: noteDraft || null } },
            {
              onSuccess: () => {
                setNotePendingId(null);
                setEditingNoteId(null);
                queryClient.invalidateQueries({
                  queryKey: getListDealsQueryKey(),
                });
                resolve();
              },
              onError: () => {
                setNotePendingId(null);
                setNoteErrorId(deal.id);
                reject(new Error("Could not save note"));
              },
            },
          );
        }),
    );
  };

  const totals = visibleDealTotals(deals);

  return (
    <div className="flex-1 flex flex-col h-full bg-muted">
      <div className="flex-none px-6 py-4 border-b bg-card flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Deals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your funding pipeline
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          {currentUser?.role === "admin" && (
            <Button
              variant="outline"
              size="sm"
              disabled={seedDeals.isPending}
              data-testid="button-seed-deals"
              onClick={() =>
                seedDeals.mutate(undefined, {
                  onSuccess: (result) => {
                    queryClient.invalidateQueries({
                      queryKey: getListDealsQueryKey(),
                    });
                    toast({
                      title: "Pipeline ready",
                      description: `${result.created} deals created; ${result.existing} already existed.`,
                    });
                  },
                  onError: () =>
                    toast({
                      title: "Pipeline seed failed",
                      variant: "destructive",
                    }),
                })
              }
            >
              {seedDeals.isPending ? "Loading pipeline…" : "Load real pipeline"}
            </Button>
          )}
          {(currentUser?.role === "rep" ||
            currentUser?.role === "manager" ||
            currentUser?.role === "admin") && (
            <Button
              variant="outline"
              size="sm"
              disabled={isExporting}
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">
                {isExporting ? "Exporting…" : "Export CSV"}
              </span>
            </Button>
          )}
          <div className="relative flex-1 min-w-[150px] sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-full sm:w-64 h-9 bg-muted border-border"
            />
          </div>
          <div className="flex rounded-md border bg-muted p-0.5 shrink-0">
            {(
              [
                ["all", "All"],
                ["fundedAndInFunding", "Funded & In Funding"],
                ["needsAction", "Needs action"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDealView(value)}
                className={cn(
                  "px-2 py-1 rounded text-xs whitespace-nowrap",
                  dealView === value
                    ? "bg-card text-success"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex border rounded-md overflow-hidden bg-muted p-0.5 shrink-0">
            <button
              onClick={() => setView("kanban")}
              className={cn(
                "px-2 py-1 rounded text-sm flex items-center gap-1",
                view === "kanban"
                  ? "bg-card text-success"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="w-4 h-4" />{" "}
              <span className="hidden sm:inline">Kanban</span>
            </button>
            <button
              onClick={() => setView("table")}
              className={cn(
                "px-2 py-1 rounded text-sm flex items-center gap-1",
                view === "table"
                  ? "bg-card text-success"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="w-4 h-4" />{" "}
              <span className="hidden sm:inline">Table</span>
            </button>
          </div>
          {view === "kanban" && (
            <button
              type="button"
              aria-pressed={compactKanban}
              aria-label="Toggle compact Kanban"
              title={compactKanban ? "Use comfortable Kanban" : "Use compact Kanban"}
              onClick={() =>
                setCompactPreference((current) =>
                  current.loadedKey === compactPreferenceKey
                    ? { ...current, value: !current.value }
                    : current,
                )
              }
              className={cn(
                "px-2 py-1 rounded-md border text-xs whitespace-nowrap",
                compactKanban
                  ? "bg-sidebar text-white border-sidebar-border"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {compactKanban ? "Compact" : "Fit 9 columns"}
            </button>
          )}
          <Link href="/deals/new" className="shrink-0">
            <Button size="sm" className="h-9">
              <Plus className="w-4 h-4 mr-1 sm:mr-1" />
              <span className="hidden sm:inline">New Deal</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        </div>
      </div>

      {dealsError && (
        <div className="px-6 pt-4">
          <QueryErrorState
            label="Deals"
            error={dealsError}
            onRetry={() => { void refetchDeals(); }}
            testId="status-deals-error"
          />
        </div>
      )}
      {usersError && (
        <div className="px-6 pt-4">
          <QueryErrorState
            label="Team members"
            error={usersError}
            onRetry={() => { void refetchUsers(); }}
            testId="status-deal-users-error"
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {isLoading ? (
          <PipelineSkeleton />
        ) : dealsError && !response ? (
          null
        ) : isRep && deals.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="rounded-xl border border-dashed bg-card px-8 py-12 text-center ">
              <UserIcon className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
              <h2 className="text-lg font-semibold text-foreground">
                No deals assigned to you yet
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Deals assigned to you will appear here.
              </p>
            </div>
          </div>
        ) : view === "kanban" && isDesktop ? (
          <div className="h-full overflow-hidden p-2" data-testid="deals-board-desktop">
            <div className="deals-board-desktop h-full">
              {STAGES.map((stage) => {
                const stageDeals = deals.filter((d) => d.stage === stage.id);
                return (
                  <div
                    key={stage.id}
                    className={cn(
                      "flex min-w-0 flex-col h-full rounded-xl border border-border bg-secondary/50 transition-colors",
                      dragOverStage === stage.id ? "bg-info-bg border-info/30" : "",
                    )}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className="flex shrink-0 items-start justify-between gap-1 rounded-t-xl border-b border-border bg-muted px-2 py-2">
                      <h3 className="deal-wrap min-w-0 text-xs font-semibold text-foreground">{stage.label}</h3>
                      <Badge variant="secondary" className="bg-card shrink-0">{stageDeals.length}</Badge>
                    </div>
                    <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-1">
                      {stageDeals.map((deal) => {
                        const rep = users?.find((u) => u.id === deal.assignedTo);
                        const linkedContact = (deal as any).lead ?? (deal as any).contact;
                        const dealIdentity = (deal as any).entityLabel || formatDealIdentity(deal as any);
                        const customDealName = deal.dealName?.trim() ?? "";
                        const personName = (deal as any).contactName || contactName(linkedContact);
                        const companyName = (deal as any).companyName?.trim() || linkedContact?.companyName?.trim();
                        const phone = (deal as any).contactPhone || linkedContact?.phone;
                        const email = (deal as any).contactEmail || linkedContact?.email;
                        const lender = deal.lenderName;
                        const days = deal.approvalExpiresOn
                          ? Math.ceil((new Date(`${deal.approvalExpiresOn}T00:00:00`).getTime() - Date.now()) / 86400000)
                          : null;
                        const stop = {
                          "data-no-deal-drag": true,
                          draggable: false,
                          onClick: (event: React.MouseEvent) => event.stopPropagation(),
                          onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
                          onDragStart: (event: React.DragEvent) => { event.preventDefault(); event.stopPropagation(); },
                        } as const;
                        const missing = (label: string) => <span className="text-muted-foreground">{label}</span>;
                        return (
                          <div
                            key={deal.id}
                            draggable
                            onDragStart={(e) => {
                              if ((e.target as HTMLElement).closest("[data-no-deal-drag]")) { e.preventDefault(); return; }
                              handleDragStart(e, deal);
                            }}
                            className="deal-wrap group relative cursor-grab overflow-hidden rounded-lg border bg-card p-2 text-[11px] leading-snug active:cursor-grabbing"
                          >
                            <Link href={`/deals/${deal.id}`} className="absolute inset-0 z-[var(--z-deal-card-bg)]" aria-label={`Open ${companyName || dealIdentity}`} />
                            <div className="pointer-events-none relative z-[var(--z-deal-card-content)] space-y-0.5">
                              <Link href={`/deals/${deal.id}`} data-no-deal-drag draggable={false}
                                onPointerDown={(e) => e.stopPropagation()}
                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                className="pointer-events-auto block text-xs font-semibold text-foreground hover:underline">
                                {companyName || dealIdentity || "Company not recorded"}
                              </Link>
                              {customDealName && customDealName !== dealIdentity && customDealName !== companyName && (
                                <p className="text-muted-foreground">{customDealName}</p>
                              )}
                              <p>{personName || missing("Contact not recorded")}</p>
                              <div className="pointer-events-auto" {...stop}>
                                {phone ? <PhoneLink phone={phone} leadId={deal.leadId ?? linkedContact?.id} showIcon={false} className="text-[11px]" /> : missing("Phone not recorded")}
                              </div>
                              {email && (
                                <div className="pointer-events-auto" {...stop}>
                                  <EmailLink email={email} leadId={deal.leadId ?? linkedContact?.id} showIcon={false} className="text-[11px] [overflow-wrap:anywhere]" />
                                </div>
                              )}
                              <p className="font-medium text-foreground">{deal.amount != null ? formatCurrency(deal.amount) : "Amount not recorded"}</p>
                              <p className="font-medium text-success">
                                GM {formatGmDisplay(deal.actualGm ?? deal.approxGm, deal.gmSplitPct ?? 100)}
                              </p>
                              <p>Lender: {lender || missing("Not assigned")}</p>
                              <p>Age: {deal.createdAt ? formatDistanceToNow(new Date(deal.createdAt)) : missing("Unknown")}</p>
                              <p>
                                Approval expiry:{" "}
                                {deal.approvalExpiresOn && days != null ? (
                                  <span className={cn(days < 0 ? "text-danger" : days <= 14 ? "text-warning" : "")}>
                                    {format(new Date(`${deal.approvalExpiresOn}T00:00:00`), "MMM d, yyyy")}
                                    {days < 0 ? " (overdue)" : days <= 14 ? ` (in ${days}d)` : ""}
                                  </span>
                                ) : missing("None recorded")}
                              </p>
                              <p className="text-muted-foreground">Rep: {rep ? getUserDisplayName(rep) : "Unassigned"}</p>
                              {deal.isArchived && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">Archived</Badge>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : view === "kanban" ? (
          <div
            className={cn(
              "h-full overflow-y-hidden",
              compactKanban
                ? "overflow-x-auto min-[1280px]:overflow-x-hidden p-2 min-[1280px]:p-0"
                : "overflow-x-auto p-6",
            )}
          >
            <div
              className={cn(
                "h-full pb-4",
                compactKanban
                  ? "grid min-w-max min-[1280px]:min-w-0"
                  : "flex gap-4 min-w-max",
              )}
              style={
                compactKanban
                  ? {
                      gridTemplateColumns: `repeat(${STAGES.length}, minmax(${KANBAN_COMPACT_COLUMN_MIN_WIDTH}px, 1fr))`,
                      gap: `${KANBAN_COMPACT_GAP}px`,
                    }
                  : undefined
              }
            >
              {STAGES.map((stage) => {
                const stageDeals = deals.filter((d) => d.stage === stage.id);
                return (
                  <div
                    key={stage.id}
                    className={cn(
                      cn(
                        "flex flex-col bg-secondary/50 rounded-xl border border-border transition-colors h-full",
                        compactKanban
                          ? "min-w-[120px]"
                          : "w-72",
                      ),
                      dragOverStage === stage.id
                        ? "bg-info-bg border-info/30"
                        : "",
                    )}
                    onDragOver={(e) => handleDragOver(e, stage.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, stage.id)}
                  >
                    <div className={cn(
                      "border-b border-border flex items-center justify-between bg-muted rounded-t-xl shrink-0",
                      compactKanban ? "px-2 py-2 gap-1" : "p-3",
                    )}>
                      <h3 className={cn(
                        "font-semibold text-sm text-foreground",
                        compactKanban && "truncate whitespace-nowrap text-xs",
                      )}>
                        {stage.label}
                      </h3>
                      <Badge variant="secondary" className="bg-card">
                        {stageDeals.length}
                      </Badge>
                    </div>
                    <div className={cn(
                      "overflow-y-auto flex-1 custom-scrollbar",
                      compactKanban ? "p-1 space-y-1" : "p-2 space-y-2",
                    )}>
                      {stageDeals.map((deal) => {
                        const rep = users?.find(
                          (u) => u.id === deal.assignedTo,
                        );
                        const linkedContact = (deal as any).lead ?? (deal as any).contact;
                        const dealIdentity = (deal as any).entityLabel || formatDealIdentity(deal as any);
                        const customDealName = deal.dealName?.trim() ?? "";
                        const personName = (deal as any).contactName || contactName(linkedContact);
                        const companyName = (deal as any).companyName?.trim() || linkedContact?.companyName?.trim();
                        const phone = (deal as any).contactPhone || linkedContact?.phone;
                        const email = (deal as any).contactEmail || linkedContact?.email;
                        const hasAuthorizedContact = Boolean(linkedContact || companyName || personName || phone);
                        return (
                          <div
                            key={deal.id}
                            draggable
                            onDragStart={(e) => {
                              if ((e.target as HTMLElement).closest("[data-no-deal-drag]")) {
                                e.preventDefault();
                                return;
                              }
                              handleDragStart(e, deal);
                            }}
                            className={cn(
                              "bg-card border rounded-lg transition-all cursor-grab active:cursor-grabbing group relative overflow-hidden",
                              compactKanban ? "p-2" : "p-3",
                            )}
                          >
                            <Link
                              href={`/deals/${deal.id}`}
                              className="absolute inset-0 z-[var(--z-deal-card-bg)]"
                            />
                            <div className="relative z-[var(--z-deal-card-content)] pointer-events-none">
                              <Link
                                href={`/deals/${deal.id}`}
                                data-no-deal-drag
                                draggable={false}
                                onPointerDown={(event) => event.stopPropagation()}
                                onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                className={cn(
                                "font-semibold text-foreground truncate whitespace-nowrap",
                                compactKanban ? "text-xs" : "text-sm",
                                )}
                              >
                                {companyName || dealIdentity}
                              </Link>
                              {customDealName && customDealName !== dealIdentity && (
                                <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={customDealName}>{customDealName}</p>
                              )}
                              {hasAuthorizedContact && (
                                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                                  {companyName && personName && (
                                    <Link
                                      href={`/deals/${deal.id}`}
                                      data-no-deal-drag
                                      draggable={false}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                      className="truncate hover:underline"
                                    >
                                      {personName}
                                    </Link>
                                  )}
                                  {phone && (
                                    <span
                                      data-no-deal-drag
                                      draggable={false}
                                      className="pointer-events-auto shrink-0"
                                      onClick={(event) => event.stopPropagation()}
                                      onPointerDown={(event) => event.stopPropagation()}
                                      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                    >
                                      <PhoneLink phone={phone} leadId={deal.leadId ?? linkedContact?.id} showIcon={false} className="text-[10px]" />
                                    </span>
                                  )}
                                  {!phone && <span className="truncate">Phone unavailable</span>}
                                </div>
                              )}
                              {email && (
                                <div
                                  data-no-deal-drag
                                  draggable={false}
                                  className="pointer-events-auto mt-0.5 min-w-0 truncate text-[10px]"
                                  onClick={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                >
                                  <EmailLink email={email} leadId={deal.leadId ?? linkedContact?.id} showIcon={false} className="max-w-full truncate text-[10px]" />
                                </div>
                              )}
                              <div className={cn(
                                "text-xs",
                                compactKanban ? "mt-1 flex items-center justify-between gap-1" : "mt-2 space-y-1.5",
                              )}>
                                <span className={cn(
                                  "font-medium text-foreground truncate",
                                  !compactKanban && "flex items-center",
                                )}>
                                  {!compactKanban && <DollarSign className="w-3 h-3 mr-0.5" />}
                                  {formatCurrency(deal.amount)}
                                </span>
                                <span className={cn(
                                  "font-medium text-success truncate",
                                  compactKanban && "rounded-full bg-success-bg px-1.5 py-0.5 text-[10px]",
                                )}>
                                  {!compactKanban && <Building2 className="w-3 h-3 mr-0.5 inline" />}
                                  {formatGmDisplay(
                                    deal.actualGm ?? deal.approxGm,
                                    deal.gmSplitPct ?? 100,
                                  )}
                                </span>
                              </div>
                              <div className={cn(
                                "border-border flex items-center justify-between",
                                compactKanban ? "mt-1 pt-1" : "mt-3 pt-3 border-t",
                              )}>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                                  <UserIcon className="w-3 h-3 shrink-0" />
                                  <span className="truncate">
                                    {compactKanban
                                      ? (rep ? getUserDisplayName(rep) : "Unassigned")
                                          .split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()
                                      : (rep ? getUserDisplayName(rep) : "Unassigned")}
                                  </span>
                                </div>
                                {deal.isArchived && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 h-4"
                                  >
                                    Archived
                                  </Badge>
                                )}
                                {deal.approvalExpiresOn && (() => {
                                  const days = Math.ceil((new Date(`${deal.approvalExpiresOn}T00:00:00`).getTime() - Date.now()) / 86400000);
                                  return days <= 14 && (
                                    <Badge variant="outline" className={cn("text-[9px] px-1 py-0 h-4", days < 0 ? "border-danger/30 bg-danger-bg text-danger" : "border-warning/30 bg-warning-bg text-warning")}>
                                      Approval expires {days < 0 ? "overdue" : `in ${days}d`}
                                    </Badge>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-6 h-full overflow-auto">
            <div className="bg-card border rounded-xl ">
              <Table className="deals-data-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="md:min-w-72">Deal / Contact</TableHead>
                    <TableHead className="hidden md:table-cell md:min-w-36">Phone</TableHead>
                    <TableHead className="hidden md:table-cell md:min-w-60">Email</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Expected GM</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Rep</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 px-3 font-medium"
                        onClick={toggleActivitySort}
                      >
                        Last Activity{" "}
                        <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center h-32 text-muted-foreground"
                      >
                        No deals found
                      </TableCell>
                    </TableRow>
                  ) : (
                    deals.map((deal) => {
                      const rep = users?.find((u) => u.id === deal.assignedTo);
                      const stageObj = STAGES.find((s) => s.id === deal.stage);
                      const linkedContact = (deal as any).lead ?? (deal as any).contact;
                      const dealIdentity = (deal as any).entityLabel || formatDealIdentity(deal as any);
                      const customDealName = deal.dealName?.trim() ?? "";
                      const phone = (deal as any).contactPhone || linkedContact?.phone;
                      const email = (deal as any).contactEmail || linkedContact?.email;
                      return (
                        <TableRow key={deal.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={`/deals/${deal.id}`}
                              className="text-success hover:underline"
                            >
                              {dealIdentity}
                              {customDealName && customDealName !== dealIdentity && <span className="block text-xs font-normal text-muted-foreground">{customDealName}</span>}
                            </Link>
                            {(phone || email) && (
                              <div className="mt-1 flex flex-col gap-1 md:hidden" onClick={(event) => event.stopPropagation()}>
                                {phone ? <PhoneLink phone={phone} leadId={deal.leadId ?? linkedContact?.id} className="text-xs" /> : <span className="text-xs text-muted-foreground">Phone unavailable</span>}
                                {email ? <EmailLink email={email} leadId={deal.leadId ?? linkedContact?.id} className="text-xs" /> : <span className="text-xs text-muted-foreground">Email unavailable</span>}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="hidden md:table-cell" onClick={(event) => event.stopPropagation()}>
                            {phone ? <PhoneLink phone={phone} leadId={deal.leadId ?? linkedContact?.id} className="text-sm" /> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell" onClick={(event) => event.stopPropagation()}>
                            {email ? <EmailLink email={email} leadId={deal.leadId ?? linkedContact?.id} className="text-sm" /> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "px-2 py-1 rounded-full text-xs font-medium",
                                stageObj?.color,
                              )}
                            >
                              {stageObj?.label || deal.stage}
                            </span>
                          </TableCell>
                          <TableCell>{formatCurrency(deal.amount)}</TableCell>
                          <TableCell>
                            {formatGmDisplay(
                              deal.actualGm ?? deal.approxGm,
                              deal.gmSplitPct ?? 100,
                            )}
                          </TableCell>
                          <TableCell
                            className="max-w-[220px]"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {editingNoteId === deal.id ? (
                              <Input
                                autoFocus
                                value={noteDraft}
                                disabled={notePendingId === deal.id}
                                onChange={(event) =>
                                  setNoteDraft(event.target.value)
                                }
                                onBlur={() => saveNote(deal)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveNote(deal);
                                  } else if (event.key === "Escape") {
                                    setEditingNoteId(null);
                                    setNoteErrorId(null);
                                  }
                                }}
                                aria-label={`Notes for ${deal.dealName}`}
                              />
                            ) : (
                              <button
                                type="button"
                                className="block w-full truncate text-left text-sm hover:text-success"
                                onClick={() => beginNoteEdit(deal)}
                                title={deal.notes ?? "Click to add notes"}
                              >
                                {notePendingId === deal.id
                                  ? "Saving…"
                                  : deal.notes || "Add note"}
                              </button>
                            )}
                            {noteErrorId === deal.id && (
                              <span className="text-xs text-destructive">
                                Could not save
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <UserIcon className="w-3.5 h-3.5" />
                              {rep ? getUserDisplayName(rep) : "Unassigned"}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            <Link
                              href={`/deals/${deal.id}`}
                              className="block w-full"
                            >
                              <LastActivity
                                at={deal.lastActivityAt}
                                actor={deal.lastActivityActor}
                              />
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(deal.createdAt), "MMM d, yyyy")}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
      <div className="flex-none border-t bg-card px-6 py-3 flex flex-wrap gap-6 text-sm">
        <span>
          <span className="text-muted-foreground">Total Approx GM:</span>{" "}
          <strong>{formatCurrency(totals.approxGm)}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Total Actual GM:</span>{" "}
          <strong>{formatCurrency(totals.actualGm)}</strong>
        </span>
      </div>

      <Dialog open={fundPromptOpen} onOpenChange={setFundPromptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Funding</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
                You are moving{" "}
                {pendingFundDeal && (
                  <strong>
                    <Link href={`/deals/${pendingFundDeal.id}`} className="text-success hover:underline">
                      {pendingFundDeal.entityLabel || formatDealIdentity(pendingFundDeal as any)}
                    </Link>
                  </strong>
                )}
                {pendingFundDeal && pendingFundDeal.dealName !== (pendingFundDeal.entityLabel || formatDealIdentity(pendingFundDeal as any)) && (
                  <> (<Link href={`/deals/${pendingFundDeal.id}`} className="hover:underline">{pendingFundDeal.dealName}</Link>)</>
                )}{" "}to Funded. Please verify the final Gross Margin (GM) before proceeding.
            </p>
            <div className="space-y-2">
              <Label>Actual GM ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  className="pl-8"
                  value={actualGm}
                  onChange={(e) => setActualGm(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFundPromptOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmFund}
              disabled={!actualGm || updateDeal.isPending}
            >
              {updateDeal.isPending ? "Saving..." : "Mark as Funded"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
