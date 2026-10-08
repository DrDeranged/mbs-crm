import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  type Campaign, useGetMe, useArchiveCampaign, useUnarchiveCampaign, useDeleteCampaign,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { canArchive, canDeleteCampaign, canManageLifecycle, canUnarchive, isCampaignQueryKey } from "@/lib/campaignLifecycle";

const errorMessage = (error: any) => error?.data?.error || error?.message || "Campaign action failed";

export function useInvalidateCampaigns() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ predicate: (q) => isCampaignQueryKey(q.queryKey) });
}

function useLifecycleMutations() {
  const invalidate = useInvalidateCampaigns();
  // Hook-level callbacks survive dropdown unmount.
  const archive = useArchiveCampaign({ mutation: {
    onSuccess: () => { invalidate(); toast.success("Campaign archived"); },
    onError: (e) => toast.error(errorMessage(e)),
  } });
  const unarchive = useUnarchiveCampaign({ mutation: {
    onSuccess: () => { invalidate(); toast.success("Campaign unarchived"); },
    onError: (e) => toast.error(errorMessage(e)),
  } });
  return { archive, unarchive };
}

export function CampaignLifecycleActions({ campaign, menu = false, onRequestDelete }: {
  campaign: Campaign; menu?: boolean; onRequestDelete: (c: Campaign) => void;
}) {
  const { data: me } = useGetMe();
  const { archive, unarchive } = useLifecycleMutations();
  const manage = canManageLifecycle(me?.role);
  const showArchive = manage && canArchive(campaign);
  const showUnarchive = manage && canUnarchive(campaign);
  const showDelete = canDeleteCampaign(me?.role, campaign);
  const busy = archive.isPending || unarchive.isPending;
  if (!showArchive && !showUnarchive && !showDelete) return null;
  if (menu) {
    return <>
      {showArchive && <DropdownMenuItem disabled={busy} onClick={() => archive.mutate({ id: campaign.id })} data-testid={`menu-archive-${campaign.id}`}><Archive className="mr-2 h-4 w-4" /> Archive</DropdownMenuItem>}
      {showUnarchive && <DropdownMenuItem disabled={busy} onClick={() => unarchive.mutate({ id: campaign.id })} data-testid={`menu-unarchive-${campaign.id}`}><ArchiveRestore className="mr-2 h-4 w-4" /> Unarchive</DropdownMenuItem>}
      {showDelete && <DropdownMenuItem onClick={() => onRequestDelete(campaign)} className="text-danger focus:text-danger" data-testid={`menu-delete-${campaign.id}`}><Trash2 className="mr-2 h-4 w-4" /> Delete</DropdownMenuItem>}
    </>;
  }
  return <>
    {showArchive && <Button variant="outline" disabled={busy} onClick={() => archive.mutate({ id: campaign.id })} data-testid="campaign-archive"><Archive className="mr-2 h-4 w-4" />Archive</Button>}
    {showUnarchive && <Button variant="outline" disabled={busy} onClick={() => unarchive.mutate({ id: campaign.id })} data-testid="campaign-unarchive"><ArchiveRestore className="mr-2 h-4 w-4" />Unarchive</Button>}
    {showDelete && <Button variant="outline" className="text-danger" onClick={() => onRequestDelete(campaign)} data-testid="campaign-delete"><Trash2 className="mr-2 h-4 w-4" />Delete</Button>}
  </>;
}

export function CampaignDeleteDialog({ campaign, onClose, onDeleted }: {
  campaign: Campaign | null; onClose: () => void; onDeleted?: (c: Campaign) => void;
}) {
  const invalidate = useInvalidateCampaigns();
  const mutation = useDeleteCampaign();
  return <Dialog open={!!campaign} onOpenChange={(open) => { if (!open && !mutation.isPending) onClose(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete “{campaign?.name}”?</DialogTitle>
        <DialogDescription>
          “{campaign?.name}” was never approved or launched. Deleting it permanently removes this draft and cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Keep campaign</Button>
        <Button variant="destructive" data-testid="campaign-confirm-delete" disabled={!campaign || mutation.isPending}
          onClick={() => campaign && mutation.mutate({ id: campaign.id }, {
            onSuccess: () => { invalidate(); toast.success(`Deleted “${campaign.name}”`); onClose(); onDeleted?.(campaign); },
            onError: (e) => toast.error(errorMessage(e)),
          })}>{mutation.isPending ? "Deleting..." : "Delete campaign"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
