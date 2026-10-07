import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type Campaign, useGetMe, useGetCampaignResults, useCancelCampaign,
  useCreateRemainingCampaign, getListCampaignsQueryKey, getGetCampaignQueryKey,
  getGetCampaignResultsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

const errorMessage = (error: any) => error?.data?.error || error?.message || "Campaign action failed";

export function CampaignRemainingAction({ campaign, menu = false }: { campaign: Campaign; menu?: boolean }) {
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const client = useQueryClient();
  // Hook-level callbacks survive the dropdown closing/unmounting after selection.
  const mutation = useCreateRemainingCampaign({ mutation: {
    onSuccess: draft => {
      client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
      toast.success("Remaining-recipient draft created. Review and approve before sending.");
      navigate(`/campaigns/${draft.id}`);
    },
    onError: error => toast.error(errorMessage(error)),
  } });
  if (me?.role !== "admin" || !["cancelled", "paused"].includes(campaign.status)) return null;
  const create = () => mutation.mutate({ id: campaign.id });
  const label = "Send remaining recipients as a new campaign";
  return menu
    ? <DropdownMenuItem onClick={create} disabled={mutation.isPending}>{label}</DropdownMenuItem>
    : <Button variant="outline" onClick={create} disabled={mutation.isPending} data-testid="campaign-send-remaining">{mutation.isPending ? "Creating draft..." : label}</Button>;
}

export function CampaignCancelDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const client = useQueryClient();
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
              client.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
              client.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
              client.invalidateQueries({ queryKey: getGetCampaignResultsQueryKey(campaign.id) });
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
