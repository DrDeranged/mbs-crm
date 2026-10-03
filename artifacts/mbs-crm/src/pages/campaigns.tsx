import { useState } from "react";
import { CampaignSkeleton } from "@/components/page-skeletons";
import { Link, useLocation } from "wouter";
import { useListCampaigns, useCreateCampaign, useDuplicateCampaign, useCancelCampaign } from "@workspace/api-client-react";
import { Plus, Mail, Copy, XCircle, Search, CalendarClock, PlayCircle, Clock, AlertTriangle, FileEdit } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getListCampaignsQueryKey } from "@workspace/api-client-react";

export function getStatusColor(status: string) {
  switch (status) {
    case "draft": return "bg-secondary text-foreground hover:bg-secondary";
    case "approved": return "bg-info-bg text-info hover:bg-info-bg";
    case "scheduled": return "bg-secondary text-chart-5 hover:bg-secondary";
    case "running": return "bg-info-bg text-info hover:bg-info-bg animate-pulse";
    case "paused": return "bg-warning-bg text-warning hover:bg-warning-bg";
    case "completed": return "bg-success-bg text-success hover:bg-success-bg";
    case "cancelled": return "bg-secondary text-foreground hover:bg-secondary";
    case "failed": return "bg-danger-bg text-danger hover:bg-danger-bg";
    default: return "bg-secondary text-foreground";
  }
}

export default function CampaignsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: campaigns, isLoading } = useListCampaigns();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [newName, setNewName] = useState("");
  const [newChannel, setNewChannel] = useState<"email" | "sms" | "email_sms">("email");

  const createCampaign = useCreateCampaign();
  const duplicateCampaign = useDuplicateCampaign();
  const cancelCampaign = useCancelCampaign();

  const filteredCampaigns = campaigns?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!newName) {
      toast.error("Please enter a campaign name");
      return;
    }
    createCampaign.mutate(
      { data: { name: newName, channel: newChannel, audienceRules: {} } },
      {
        onSuccess: (newC) => {
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          toast.success("Campaign created");
          setIsCreateOpen(false);
          setLocation(`/campaigns/${newC.id}`);
        },
        onError: () => toast.error("Failed to create campaign")
      }
    );
  };

  const handleDuplicate = (id: number) => {
    duplicateCampaign.mutate(
      { id },
      {
        onSuccess: (newC) => {
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          toast.success("Campaign duplicated");
          setLocation(`/campaigns/${newC.id}`);
        },
        onError: () => toast.error("Failed to duplicate campaign")
      }
    );
  };

  const handleCancel = (id: number) => {
    cancelCampaign.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey() });
          toast.success("Campaign cancelled");
        },
        onError: () => toast.error("Failed to cancel campaign")
      }
    );
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-shrink-0 items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground">Manage, launch, and track outreach campaigns.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-create-campaign">
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>Set a name and primary channel for your new campaign.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Campaign Name</Label>
                <Input
                  id="name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Q3 Healthcare Outreach"
                />
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={newChannel} onValueChange={(val: any) => setNewChannel(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="email_sms">Email & SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createCampaign.isPending}>
                {createCampaign.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="flex-1 overflow-auto bg-muted p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search campaigns..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-card"
              />
            </div>
          </div>

          {isLoading ? (
            <CampaignSkeleton />
          ) : filteredCampaigns?.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card py-24 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary mb-4">
                <Mail className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground">No campaigns found</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                {search ? "No campaigns match your search." : "Get started by creating your first outreach campaign."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredCampaigns?.map(campaign => (
                <Card key={campaign.id} className="overflow-hidden transition-colors hover:border-border">
                  <div className="flex flex-col sm:flex-row sm:items-center p-5 gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-3">
                        <Link href={`/campaigns/${campaign.id}`} className="text-lg font-semibold text-foreground hover:text-success hover:underline truncate">
                          {campaign.name}
                        </Link>
                        <Badge variant="secondary" className={getStatusColor(campaign.status)}>
                          {campaign.status.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {campaign.description || "No description provided."}
                      </p>
                    </div>

                    <div className="flex items-center gap-6 text-sm text-muted-foreground shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-4 w-4" />
                        <span className="capitalize">{campaign.channel.replace("_", " & ")}</span>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" asChild>
                          <Link href={`/campaigns/${campaign.id}`}>
                            <FileEdit className="h-4 w-4 mr-2" />
                            Manage
                          </Link>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-9 w-9">
                              <span className="sr-only">Open menu</span>
                              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4"><path d="M3.625 7.5C3.625 8.12132 3.12132 8.625 2.5 8.625C1.87868 8.625 1.375 8.12132 1.375 7.5C1.375 6.87868 1.87868 6.375 2.5 6.375C3.12132 6.375 3.625 6.87868 3.625 7.5ZM8.625 7.5C8.625 8.12132 8.12132 8.625 7.5 8.625C6.87868 8.625 6.375 8.12132 6.375 7.5C6.375 6.87868 6.87868 6.375 7.5 6.375C8.12132 6.375 8.625 6.87868 8.625 7.5ZM13.625 7.5C13.625 8.12132 13.1213 8.625 12.5 8.625C11.8786 8.625 11.375 8.12132 11.375 7.5C11.375 6.87868 11.8786 6.375 12.5 6.375C13.1213 6.375 13.625 6.87868 13.625 7.5Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleDuplicate(campaign.id)}>
                              <Copy className="mr-2 h-4 w-4" /> Duplicate
                            </DropdownMenuItem>
                            {["scheduled", "running", "paused"].includes(campaign.status) && (
                              <DropdownMenuItem onClick={() => handleCancel(campaign.id)} className="text-danger focus:text-danger">
                                <XCircle className="mr-2 h-4 w-4" /> Cancel Campaign
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
