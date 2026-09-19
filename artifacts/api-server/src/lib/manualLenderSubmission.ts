export type ManualSubmissionValues = {
  leadId: number;
  dealId: number | null;
  lenderId: number;
  sentBy: number;
  status: string;
  notes: string | null;
  sentAt: Date;
  decisionDate: Date | null;
  approvalAttachmentKey: string | null;
};

export async function recordManualLenderSubmission<T extends { id: number; status: string }>(
  dependencies: {
    insert: (values: ManualSubmissionValues & { source: "manual" }) => Promise<T>;
    logActivity: (params: {
      userId: number;
      leadId: number;
      dealId: number | null;
      action: "lender_submission_logged";
      entityType: "lender_submission";
      entityId: number;
      details: { source: "manual"; status: string };
    }) => Promise<unknown>;
  },
  values: ManualSubmissionValues,
): Promise<T> {
  const row = await dependencies.insert({ ...values, source: "manual" });
  await dependencies.logActivity({
    userId: values.sentBy,
    leadId: values.leadId,
    dealId: values.dealId,
    action: "lender_submission_logged",
    entityType: "lender_submission",
    entityId: row.id,
    details: { source: "manual", status: row.status },
  });
  return row;
}