import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  type Campaign, useGetMe, useGetCampaignResults, useCancelCampaign,
  useCreateRemainingCampaign, useGetCampaignRecovery, getGetCampaignRecoveryQueryKey,
  getGetCampaignResultsQueryKey,
} from "@workspace/api-client-react";
import { useInvalidateCampaigns } from "@/components/campaign-lifecycle-actions";
import { cancelledSummary, canViewRecovery, recoveryAction, shouldPollRecovery } from "@/lib/campaignLifecycle";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const errorMessage = (error: any) => error?.data?.error || error?.message || "Campaign action failed";

export function useCampaignRecovery(campaign: Campaign) {
  const { data: me } = useGetMe();
  const enabled = canViewRecovery(me?.role) && ["cancelled", "paused"].includes(campaign.status);
  return useGetCampaignRecovery(campaign.id, { query: {
    enabled, queryKey: getGetCampaignRecoveryQueryKey(campaign.id),
    refetchInterval: (q: any) => shouldPollRecovery(q?.state?.data) ? 5000 : false,
  } as any });
}

export function CampaignRecoverySummary({ campaign }: { campaign: Campaign }) {
  const recovery = useCampaignRecovery(campaign);
  if (!recovery.data) return null;
  const s = cancelledSummary(recovery.data);
  return <div className="rounded-lg border bg-muted p-4 text-sm" data-testid="campaign-recovery-summary">
    <p className="font-medium text-foreground">{s.headline}</p>
    {s.pending && <p className="mt-1 text-muted-foreground">{s.pending}</p>}
  </div>;
}

export function CampaignRemainingAction({ campaign, menu = false }: { campaign: Campaign; menu?: boolean }) {
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateCampaigns();
  const recovery = useCampaignRecovery(campaign);
  // Hook-level callbacks survive the dropdown closing/unmounting after selection.
  const mutation = useCreateRemainingCampaign({ mutation: {
    onSuccess: draft => {
      invalidate();
      toast.success("Remaining-recipient draft created. Review and approve before sending.");
      navigate(`/campaigns/${draft.id}`);
    },
    onError: error => toast.error(errorMessage(error)),
  } });
  if (!["cancelled", "paused"].includes(campaign.status)) return null;
  const action = recoveryAction(me?.role, recovery.data);
  if (action.kind === "none") return null;
  if (action.kind === "create" && campaign.archivedAt) return null;
  if (action.kind === "linked") {
    const go = () => navigate(`/campaigns/${action.campaignId}`);
    return menu
      ? <DropdownMenuItem onClick={go}>{action.label}</DropdownMenuItem>
      : <Button variant="outline" onClick={go} data-testid="campaign-recovery-linked">{action.label}</Button>;
  }
  const create = () => mutation.mutate({ id: campaign.id });
  const label = "Send remaining recipients as a new campaign";
  return menu
    ? <DropdownMenuItem onClick={create} disabled={mutation.isPending}>{label}</DropdownMenuItem>
    : <Button variant="outline" onClick={create} disabled={mutation.isPending} data-testid="campaign-send-remaining">{mutation.isPending ? "Creating draft..." : label}</Button>;
}

export function CampaignCancelDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const invalidate = useInvalidateCampaigns();
  const mutation = useCancelCampaign();
  const results = useGetCampaignResults(campaign?.id ?? 0, {
    query: { queryKey: getGetCampaignResultsQueryKey(campaign?.id ?? 0), enabled: !!campaign, refetchOnMount: "always", refetchInterval: 5000 },
  });
  const queued = results.data?.counts.queued;
  return <Dialog open={!!campaign} onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Cancel “{campaign?.name}”?</DialogTitle>
        <DialogDescription>
          {results.isError ? "Unable to load the queued count. Close and try again." :
            queued == null || results.isFetching ? "Checking the current queued count..." :
            `${queued} recipients are currently queued, including deferred recipients. Already sent messages cannot be recalled. A cancelled campaign cannot resume.`}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Keep campaign</Button>
        <Button variant="destructive" data-testid="campaign-confirm-cancel"
          disabled={!campaign || queued == null || results.isError || results.isFetching || mutation.isPending}
          onClick={() => campaign && mutation.mutate({ id: campaign.id }, {
            onSuccess: () => {
              invalidate();
              toast.success("Campaign cancelled");
              onClose();
            },
            onError: error => toast.error(errorMessage(error)),
          })}>{mutation.isPending ? "Cancelling..." : "Cancel campaign"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function CampaignCancelAction({ campaign }: { campaign: Campaign }) {
  const [open, setOpen] = useState(false);
  if (!["scheduled", "running", "paused"].includes(campaign.status)) return null;
  return <>
    <Button variant="destructive" onClick={() => setOpen(true)}>Cancel Campaign</Button>
    <CampaignCancelDialog campaign={open ? campaign : null} onClose={() => setOpen(false)} />
  </>;
}
