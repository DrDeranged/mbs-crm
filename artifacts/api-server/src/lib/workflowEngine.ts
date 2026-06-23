import { db } from "@workspace/db";
import { workflowRulesTable, tasksTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createNotification } from "./notify";
import { logger } from "./logger";

const DEFAULT_RULES: Array<{
  name: string;
  triggerStatus: string;
  actionType: "create_task" | "send_notification";
  actionConfig: Record<string, unknown>;
}> = [
  {
    name: "Follow up after contact",
    triggerStatus: "contacted",
    actionType: "create_task",
    actionConfig: { title: "Follow up within 24h", description: "Reach back out to the lead to keep the conversation moving.", dueDaysFromNow: 1 },
  },
  {
    name: "Review application",
    triggerStatus: "application_received",
    actionType: "create_task",
    actionConfig: { title: "Review application", description: "Review the submitted application for completeness and accuracy.", dueDaysFromNow: 2 },
  },
  {
    name: "Check lender response",
    triggerStatus: "submitted",
    actionType: "create_task",
    actionConfig: { title: "Check lender response", description: "Follow up with lenders to confirm submission receipt and expected timeline.", dueDaysFromNow: 3 },
  },
  {
    name: "Notify merchant of approval",
    triggerStatus: "approved",
    actionType: "create_task",
    actionConfig: { title: "Notify merchant of approval", description: "Contact the merchant to share the good news and discuss next steps.", dueDaysFromNow: 1 },
  },
  {
    name: "Confirm funding received",
    triggerStatus: "funded",
    actionType: "create_task",
    actionConfig: { title: "Confirm funding received", description: "Verify with the merchant that funds have been deposited and everything is in order.", dueDaysFromNow: 1 },
  },
  {
    name: "Discuss alternatives after decline",
    triggerStatus: "declined",
    actionType: "create_task",
    actionConfig: { title: "Discuss alternatives", description: "Reach out to the merchant to discuss alternative funding options or re-application strategy.", dueDaysFromNow: 2 },
  },
];

export async function seedDefaultWorkflowRules(): Promise<void> {
  try {
    const existing = await db.select().from(workflowRulesTable).limit(1);
    if (existing.length > 0) return;
    await db.insert(workflowRulesTable).values(DEFAULT_RULES);
    logger.info("Seeded 6 default workflow rules");
  } catch (err) {
    logger.warn({ err }, "Failed to seed default workflow rules");
  }
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

export async function executeWorkflowRules(
  leadId: number,
  newStatus: string,
  assignedRepId: number | null | undefined,
  triggeringUserId: number,
): Promise<void> {
  try {
    const rules = await db.query.workflowRulesTable.findMany({
      where: and(
        eq(workflowRulesTable.triggerStatus, newStatus),
        eq(workflowRulesTable.isActive, true),
      ),
    });

    if (rules.length === 0) return;

    const taskAssignee = assignedRepId ?? triggeringUserId;

    for (const rule of rules) {
      const cfg = rule.actionConfig as Record<string, unknown>;

      if (rule.actionType === "create_task") {
        const title = (cfg["title"] as string | undefined) ?? rule.name;
        const description = (cfg["description"] as string | undefined) ?? null;
        const dueDaysFromNow = (cfg["dueDaysFromNow"] as number | undefined) ?? 1;
        const dueDate = addDays(dueDaysFromNow);

        await db.insert(tasksTable).values({
          leadId,
          userId: taskAssignee,
          title,
          description,
          dueDate,
          isCompleted: false,
        });
      } else if (rule.actionType === "send_notification") {
        if (!assignedRepId) continue;
        const title = (cfg["title"] as string | undefined) ?? rule.name;
        const body = (cfg["body"] as string | undefined) ?? `A lead has moved to ${newStatus.replace(/_/g, " ")}`;
        await createNotification({ userId: assignedRepId, type: "status_changed", title, body, leadId });
      }
    }
  } catch (err) {
    logger.warn({ err, leadId, newStatus }, "[workflowEngine] Failed to execute workflow rules");
  }
}
