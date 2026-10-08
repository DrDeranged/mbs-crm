export const archivableCampaign = (status: string) =>
  ["draft", "completed", "cancelled", "failed"].includes(status);

export const deletableCampaign = (status: string, approvalHistory: boolean, launchHistory: boolean) =>
  status === "draft" && !approvalHistory && !launchHistory;
