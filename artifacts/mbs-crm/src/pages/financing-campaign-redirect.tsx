import { useEffect } from "react";
import { useLocation } from "wouter";
import { useListCampaigns } from "@workspace/api-client-react";

export default function FinancingCampaignRedirect() {
  const [, setLocation] = useLocation();
  const { data: campaigns, isLoading } = useListCampaigns();

  useEffect(() => {
    if (!isLoading && campaigns) {
      const financingCampaign = campaigns.find(c => c.name.toLowerCase().includes("financing"));
      if (financingCampaign) {
        setLocation(`/campaigns/${financingCampaign.id}`);
      } else if (campaigns.length > 0) {
        setLocation(`/campaigns/${campaigns[0].id}`);
      } else {
        setLocation(`/campaigns`);
      }
    }
  }, [isLoading, campaigns, setLocation]);

  return (
    <div className="flex h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-slate-500">Loading campaign...</p>
      </div>
    </div>
  );
}
