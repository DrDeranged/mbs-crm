import { db } from "@workspace/db";
import {
  dripEnrollmentsTable,
  dripSequenceStepsTable,
  dripSequencesTable,
  emailTemplatesTable,
  leadsTable,
  usersTable,
  jobRunsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { doSendEmail, renderTemplate, buildVariables, FROM_EMAIL } from "../routes/email";
import { logActivity } from "./activityHelper";
import { logger } from "./logger";

let running: boolean | undefined;

export async function runDripJob(): Promise<void> {
  if (running) {
    logger.warn("Drip job already running, skipping overlapping run");
    return;
  }
  running = true;

  const startedAt = new Date();
  let status: "success" | "error" = "success";
  let itemsProcessed = 0;
  let errorMessage: string | undefined;

  try {
    const activeEnrollments = await db.query.dripEnrollmentsTable.findMany({
      where: eq(dripEnrollmentsTable.status, "active"),
      with: {
        sequence: {
          with: {
            steps: {
              orderBy: (s: any, { asc }: any) => [asc(s.stepOrder)],
            },
          },
        },
        lead: true,
      },
    });

    for (const enrollment of activeEnrollments) {
      try {
        const steps = enrollment.sequence?.steps ?? [];
        const nextStepIndex = enrollment.currentStep; // 0-indexed

        if (nextStepIndex >= steps.length) {
          // All steps sent — mark complete
          await db.update(dripEnrollmentsTable)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(dripEnrollmentsTable.id, enrollment.id));
          continue;
        }

        const step = steps[nextStepIndex];

        // Check if delay has passed
        const lastSent = enrollment.lastStepSentAt ?? enrollment.enrolledAt;
        const delayMs = (step.delayHours || 0) * 60 * 60 * 1000;
        const nextSendTime = new Date(lastSent.getTime() + delayMs);

        if (new Date() < nextSendTime) {
          continue; // Not time yet
        }

        const lead = enrollment.lead;
        if (!lead || !lead.email || lead.isUnsubscribed) {
          // Skip — mark complete to avoid re-processing
          await db.update(dripEnrollmentsTable)
            .set({ status: "unenrolled", unenrolledAt: new Date() })
            .where(eq(dripEnrollmentsTable.id, enrollment.id));
          continue;
        }

        // Load template
        const template = await db.query.emailTemplatesTable.findFirst({
          where: eq(emailTemplatesTable.id, step.templateId),
        });
        if (!template) continue;

        // Load assigned rep
        const rep = lead.assignedRepId
          ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, lead.assignedRepId) })
          : null;

        const vars = buildVariables(lead, rep);
        const subject = renderTemplate(template.subject, vars);
        const bodyHtml = renderTemplate(template.bodyHtml, vars);

        const baseUrl = process.env["API_BASE_URL"] ||
          (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "http://localhost:8080");

        const { send, error: sendError } = await doSendEmail({
          leadId: lead.id,
          userId: null,
          templateId: template.id,
          subject,
          bodyHtml,
          toEmail: lead.email,
          baseUrl,
        });

        if (sendError) {
          logger.error({ enrollmentId: enrollment.id, leadId: lead.id, error: sendError }, "Drip step send failed");
          continue;
        }

        // Log activity for this drip send
        await logActivity({
          userId: null,
          leadId: lead.id,
          action: "email_sent",
          entityType: "email_send",
          entityId: send.id,
          details: { subject, to: lead.email, drip: true, sequenceId: enrollment.sequenceId, step: nextStepIndex + 1 },
        });

        // Advance enrollment
        const newStep = nextStepIndex + 1;
        const isLast = newStep >= steps.length;
        await db.update(dripEnrollmentsTable)
          .set({
            currentStep: newStep,
            lastStepSentAt: new Date(),
            status: isLast ? "completed" : "active",
            completedAt: isLast ? new Date() : null,
          })
          .where(eq(dripEnrollmentsTable.id, enrollment.id));

        logger.info({ enrollmentId: enrollment.id, leadId: lead.id, step: newStep }, "Drip step sent");
        itemsProcessed++;
      } catch (err) {
        logger.error({ err, enrollmentId: enrollment.id }, "Error processing drip enrollment");
      }
    }
  } catch (err) {
    status = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Drip job failed");
  } finally {
    running = false;
    db.insert(jobRunsTable)
      .values({
        jobName: "drip",
        startedAt,
        finishedAt: new Date(),
        status,
        itemsProcessed,
        errorMessage: errorMessage ?? null,
      })
      .catch((dbErr: unknown) => {
        logger.error({ err: dbErr }, "Failed to write drip job run");
      });
  }
}
