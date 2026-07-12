import { db } from "@workspace/db";
import { leadsTable, usersTable, jobRunsTable } from "@workspace/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { logActivity } from "./activityHelper";
import { createNotification, notifyAllManagers } from "./notify";
import { logger } from "./logger";

const DEFAULT_TERM_MONTHS = 6;
const RENEWAL_THRESHOLD_RATIO = 0.6;
const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

let running: boolean | undefined;

export async function runRenewalJob(): Promise<void> {
  if (running) {
    logger.warn("Renewal job already running, skipping overlapping run");
    return;
  }
  running = true;

  const startedAt = new Date();
  let status: "success" | "error" = "success";
  let itemsProcessed = 0;
  let errorMessage: string | undefined;

  try {
    const fundedLeads = await db.query.leadsTable.findMany({
      where: and(
        eq(leadsTable.status, "funded"),
        isNotNull(leadsTable.fundedAt),
        isNull(leadsTable.renewalFlaggedAt),
      ),
    });

    const now = Date.now();

    for (const lead of fundedLeads) {
      try {
        if (!lead.fundedAt) continue;

        const termMonths = lead.estimatedTermMonths ?? DEFAULT_TERM_MONTHS;
        const termMs = termMonths * MS_PER_MONTH;
        if (termMs <= 0) continue;

        const elapsedMs = now - lead.fundedAt.getTime();
        const progressRatio = elapsedMs / termMs;

        if (progressRatio < RENEWAL_THRESHOLD_RATIO) continue;

        const flaggedAt = new Date();
        await db
          .update(leadsTable)
          .set({ renewalFlaggedAt: flaggedAt })
          .where(eq(leadsTable.id, lead.id));

        const leadName =
          [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
          lead.companyName ||
          "A funded lead";
        const notifTitle = "Renewal opportunity";
        const notifBody = `${leadName} is ${Math.round(progressRatio * 100)}% through its estimated term and may be ready to re-fund.`;

        if (lead.assignedRepId) {
          const rep = await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) });
          if (rep) {
            await createNotification({
              userId: rep.id,
              type: "renewal_opportunity",
              title: notifTitle,
              body: notifBody,
              leadId: lead.id,
            });
          }
        }

        await notifyAllManagers("renewal_opportunity", notifTitle, notifBody, lead.id);

        await logActivity({
          userId: null,
          leadId: lead.id,
          action: "renewal_flagged",
          entityType: "lead",
          entityId: lead.id,
          details: {
            fundedAt: lead.fundedAt.toISOString(),
            estimatedTermMonths: termMonths,
            progressRatio: Math.round(progressRatio * 100) / 100,
          },
        });

        logger.info({ leadId: lead.id, progressRatio }, "Lead flagged for renewal");
        itemsProcessed++;
      } catch (err) {
        logger.error({ err, leadId: lead.id }, "Error processing lead for renewal flagging");
      }
    }
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Renewal job failed");
  } finally {
    running = false;
    db.insert(jobRunsTable)
      .values({
        jobName: "renewal",
        startedAt,
        finishedAt: new Date(),
        status,
        itemsProcessed,
        errorMessage: errorMessage ?? null,
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, "Failed to write renewal job run");
      });
  }
}
