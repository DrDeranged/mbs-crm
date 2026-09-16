import { google } from "googleapis";
import { eq, sql } from "drizzle-orm";
import { db, documentsTable, leadsTable, usfaApplicationEmailLogTable, usfaIntakeLogTable } from "@workspace/db";
import { objectStorageClient } from "../objectStorage";
import { logger } from "../logger";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const DEFAULT_FUNDING_ADDRESS = "funding@my-business-solutions.com";
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

type GmailPart = {
  mimeType?: string | null;
  filename?: string | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null };
  headers?: Array<{ name?: string | null; value?: string | null }>;
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string | null;
  internalDate?: string | null;
  payload?: GmailPart | null;
};
type GmailClient = {
  users: {
    messages: {
      list: (params: Record<string, unknown>) => Promise<{ data: { messages?: Array<{ id?: string | null }>; nextPageToken?: string | null } }>;
      get: (params: Record<string, unknown>) => Promise<{ data: GmailMessage }>;
      attachments: { get: (params: Record<string, unknown>) => Promise<{ data: { data?: string | null } }> };
    };
  };
};

function credentials(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const subject = process.env.GOOGLE_WORKSPACE_DELEGATION_SUBJECT;
  if (!raw || !subject) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

export function decodeGmailBase64(data: string | null | undefined): Buffer {
  return Buffer.from((data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function allParts(part: GmailPart | null | undefined): GmailPart[] {
  if (!part) return [];
  return [part, ...(part.parts || []).flatMap(allParts)];
}

function header(message: GmailMessage, name: string): string {
  return (message.payload?.headers || []).find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value?.trim() || "";
}

export type UsfaPdfAttachment = { filename: string; data: Buffer };
export function extractUsfaPdf(message: GmailMessage): UsfaPdfAttachment | null {
  const part = allParts(message.payload).find((candidate) =>
    candidate.mimeType === "application/pdf" && Boolean(candidate.filename),
  );
  if (!part?.filename || !part.body?.data) return null;
  return { filename: part.filename, data: decodeGmailBase64(part.body.data) };
}

async function fetchUsfaPdf(client: GmailClient, messageId: string, message: GmailMessage): Promise<UsfaPdfAttachment | null> {
  const part = allParts(message.payload).find((candidate) =>
    candidate.mimeType === "application/pdf" && Boolean(candidate.filename),
  );
  if (!part?.filename) return null;
  if (part.body?.data) return { filename: part.filename, data: decodeGmailBase64(part.body.data) };
  if (!part.body?.attachmentId) return null;
  const response = await client.users.messages.attachments.get({
    userId: "me", messageId, id: part.body.attachmentId,
  });
  if (!response.data.data) return null;
  return { filename: part.filename, data: decodeGmailBase64(response.data.data) };
}

export async function listAllMessages(client: GmailClient, query: string): Promise<Array<{ id?: string | null }>> {
  const messages: Array<{ id?: string | null }> = [];
  let pageToken: string | undefined;
  do {
    const response = await client.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    messages.push(...(response.data.messages || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return messages;
}

export function usfaDocumentFileKey(leadId: number, messageId: string): string {
  return `leads/${leadId}/documents/usfa-application-${messageId}.pdf`;
}

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

async function claimMessage(messageId: string, receivedAt: Date, expiresAtValue: Date, metadata: Record<string, unknown>): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"usfa-gmail:" + messageId}))`);
    const [prior] = await tx.select().from(usfaApplicationEmailLogTable)
      .where(eq(usfaApplicationEmailLogTable.gmailMessageId, messageId)).limit(1);
    if (prior?.status === "attached" || prior?.status === "expired") return false;
    if (prior?.status === "processing" && Date.now() - prior.attemptedAt.getTime() < PROCESSING_LEASE_MS) return false;
    await tx.insert(usfaApplicationEmailLogTable).values({
      gmailMessageId: messageId, status: "processing", receivedAt, expiresAt: expiresAtValue, metadata,
    }).onConflictDoUpdate({
      target: usfaApplicationEmailLogTable.gmailMessageId,
      set: { status: "processing", attemptedAt: new Date(), receivedAt, expiresAt: expiresAtValue, metadata, error: null },
    });
    return true;
  });
}

async function markMessageAttached(
  messageId: string,
  leadId: number,
  receivedAt: Date,
  expiresAtValue: Date,
  identity: Record<string, unknown>,
  document: { filename: string; fileKey: string; fileSize: number },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"usfa-gmail:" + messageId}))`);
    const [prior] = await tx.select().from(usfaApplicationEmailLogTable)
      .where(eq(usfaApplicationEmailLogTable.gmailMessageId, messageId)).limit(1);
    if (prior?.status === "attached") return false;
    await tx.insert(documentsTable).values({
      leadId, userId: null, filename: document.filename, fileKey: document.fileKey,
      fileType: "application/pdf", fileSize: document.fileSize, category: "other", label: "USFA application",
    }).onConflictDoNothing();
    await tx.insert(usfaApplicationEmailLogTable).values({
      gmailMessageId: messageId, leadId, status: "attached", receivedAt,
      expiresAt: expiresAtValue, metadata: { ...identity, label: "USFA application" },
    }).onConflictDoUpdate({
      target: usfaApplicationEmailLogTable.gmailMessageId,
      set: { leadId, status: "attached", attemptedAt: new Date(), metadata: { ...identity, label: "USFA application" }, error: null },
    });
    return true;
  });
}

function textBody(message: GmailMessage): string {
  return allParts(message.payload)
    .filter((part) => part.mimeType === "text/plain" && part.body?.data)
    .map((part) => decodeGmailBase64(part.body?.data).toString("utf8"))
    .join("\n");
}

export function extractUsfaEmailIdentity(message: GmailMessage): { externalId?: string; company?: string; email?: string } {
  const text = textBody(message);
  const value = (label: string) => text.match(new RegExp(`^\\s*(?:${label})\\s*[:#]\\s*(.+?)\\s*$`, "im"))?.[1]?.trim();
  const externalId = value("external[_ -]?id|usfa[_ -]?id");
  const email = value("email")?.toLowerCase();
  const company = value("company|company name");
  return { externalId, email, company };
}

function serviceGmail(): GmailClient | null {
  const credential = credentials();
  if (!credential) return null;
  const subject = process.env.GOOGLE_WORKSPACE_DELEGATION_SUBJECT;
  if (!subject) return null;
  const auth = new google.auth.JWT({
    email: credential.client_email,
    key: credential.private_key,
    scopes: [GMAIL_READONLY_SCOPE],
    subject,
  });
  return google.gmail({ version: "v1", auth }) as unknown as GmailClient;
}

function fundingAddress(): string {
  return process.env.USFA_FUNDING_EMAIL || DEFAULT_FUNDING_ADDRESS;
}

function expiresAt(message: GmailMessage): Date {
  const received = Number(message.internalDate || Date.now());
  return new Date(received + RETRY_WINDOW_MS);
}

export type UsfaApplicationRunResult = {
  status: "ok" | "skipped";
  reason?: string;
  listed: number;
  attached: number;
  pending: number;
  expired: number;
  errors: number;
};

export async function runUsfaApplicationPoll(options: { gmail?: GmailClient } = {}): Promise<UsfaApplicationRunResult> {
  const client = options.gmail || serviceGmail();
  if (!client) return { status: "skipped", reason: "Gmail service-account delegation is not configured", listed: 0, attached: 0, pending: 0, expired: 0, errors: 0 };
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) return { status: "skipped", reason: "Object Storage is not configured", listed: 0, attached: 0, pending: 0, expired: 0, errors: 0 };
  const query = `to:${fundingAddress()} subject:"Lead Application" newer_than:2d`;
  const listedMessages = await listAllMessages(client, query);
  const result: UsfaApplicationRunResult = { status: "ok", listed: listedMessages.length, attached: 0, pending: 0, expired: 0, errors: 0 };

  for (const listedMessage of listedMessages) {
    const messageId = listedMessage.id;
    if (!messageId) continue;
    try {
      const message = (await client.users.messages.get({ userId: "me", id: messageId, format: "full" })).data;
      const receivedAt = new Date(Number(message.internalDate || Date.now()));
      const expires = expiresAt(message);
      const identity = extractUsfaEmailIdentity(message);
      if (!(await claimMessage(messageId, receivedAt, expires, identity))) continue;
      let lead: typeof leadsTable.$inferSelect | undefined;
      if (identity.externalId) {
        const row = await db.query.usfaIntakeLogTable.findFirst({
          where: eq(usfaIntakeLogTable.externalId, identity.externalId),
          with: { lead: true },
        });
        lead = row?.lead ?? undefined;
      }
      if (!lead && identity.email && identity.company) {
        const row = await db.query.leadsTable.findFirst({
          where: eq(leadsTable.email, identity.email),
          with: { company: true },
        });
        if (row?.company?.name?.toLowerCase() === identity.company.toLowerCase()) lead = row;
      }
      if (!lead) {
        if (Date.now() >= expires.getTime()) {
          await db.insert(usfaApplicationEmailLogTable).values({ gmailMessageId: messageId, status: "expired", receivedAt, expiresAt: expires, metadata: identity }).onConflictDoUpdate({ target: usfaApplicationEmailLogTable.gmailMessageId, set: { status: "expired", attemptedAt: new Date(), metadata: identity } });
          result.expired++;
        } else {
          await db.insert(usfaApplicationEmailLogTable).values({ gmailMessageId: messageId, status: "pending", receivedAt, expiresAt: expires, metadata: identity }).onConflictDoUpdate({ target: usfaApplicationEmailLogTable.gmailMessageId, set: { status: "pending", attemptedAt: new Date(), metadata: identity } });
          result.pending++;
        }
        continue;
      }
      const attachment = await fetchUsfaPdf(client, messageId, message);
      if (!attachment) throw new Error("No PDF attachment found");
       const fileKey = usfaDocumentFileKey(lead.id, messageId);
      await objectStorageClient.bucket(bucketId).file(fileKey).save(attachment.data, { contentType: "application/pdf", resumable: false });
      if (await markMessageAttached(messageId, lead.id, receivedAt, expires, identity, { filename: attachment.filename, fileKey, fileSize: attachment.data.length })) {
        result.attached++;
      }
    } catch (error) {
      result.errors++;
      logger.error({ err: error, messageId }, "USFA application email processing failed");
      await db.insert(usfaApplicationEmailLogTable).values({
        gmailMessageId: messageId, status: "error", receivedAt: new Date(), expiresAt: new Date(Date.now() + RETRY_WINDOW_MS),
        error: error instanceof Error ? error.message : "Unknown Gmail processing error",
      }).onConflictDoUpdate({
        target: usfaApplicationEmailLogTable.gmailMessageId,
        set: {
          status: "error",
          attemptedAt: new Date(),
          error: error instanceof Error ? error.message : "Unknown Gmail processing error",
        },
      });
    }
  }
  return result;
}

export function startUsfaApplicationPoller(): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    runUsfaApplicationPoll().catch((error) => logger.error({ err: error }, "USFA application email poll failed"));
  }, 5 * 60 * 1000);
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID) {
    logger.info("USFA application poller disarmed: Gmail delegation or Object Storage is not configured");
  }
  return interval;
}