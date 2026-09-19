import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import { db, companySettingsTable } from "@workspace/db";
import { ingestUsfaRow } from "../lib/intake/usfaPoller";

const router = Router();

const optionalText = z.string().nullable().optional();
export const UsfaWebhookPayload = z.object({
  id: z.string().trim().min(1),
  company: optionalText,
  creditScore: z.union([z.string(), z.number()]).nullable().optional(),
  industry: optionalText,
  ownerName: optionalText,
  firstName: optionalText,
  lastName: optionalText,
  email: optionalText,
  phone1: optionalText,
  phone2: optionalText,
  ein: optionalText,
  startDate: optionalText,
  ssn: optionalText,
  street: optionalText,
  city: optionalText,
  state: optionalText,
  zip: z.union([z.string(), z.number()]).nullable().optional(),
  dob: optionalText,
  revenue: z.number().finite().nonnegative(),
  amountRequested: z.number().finite().nonnegative().nullable().optional(),
  createdAt: optionalText,
  statement1: optionalText,
  statement2: optionalText,
  statement3: optionalText,
  statement4: optionalText,
}).strict();

export function verifyUsfaWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!signature || !secret) return false;
  const provided = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(provided.toLowerCase(), "utf8"), Buffer.from(expected, "utf8"));
}

router.post("/intake/usfa", async (req: Request, res: Response): Promise<void> => {
  const rawBody = req.rawBody;
  const signature = req.get("x-usfa-signature") ?? undefined;
  if (!verifyUsfaWebhookSignature(rawBody ?? Buffer.alloc(0), signature, process.env.USFA_WEBHOOK_SECRET)) {
    res.status(401).json({ error: "Invalid USFA webhook signature" });
    return;
  }

  const parsed = UsfaWebhookPayload.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "body";
    res.status(400).json({ error: `Invalid ${field}`, field });
    return;
  }

  const [settings] = await db.select({ enabled: companySettingsTable.usfaWebhookEnabled }).from(companySettingsTable).limit(1);
  if (!settings?.enabled) {
    res.status(404).json({ error: "USFA webhook is disabled" });
    return;
  }

  const payload = parsed.data;
  try {
    const result = await ingestUsfaRow({
      Id: payload.id,
      COMPANY: payload.company,
      "Credit Score": payload.creditScore,
      Industry: payload.industry,
      "OWNER NAME": payload.ownerName,
      "First Name": payload.firstName,
      "Last Name": payload.lastName,
      Email: payload.email,
      "Phone 1": payload.phone1,
      "Phone 2": payload.phone2,
      EIN: payload.ein,
      "START DATE": payload.startDate,
      SSN: payload.ssn,
      Street: payload.street,
      City: payload.city,
      State: payload.state,
      "Zip/postal code": payload.zip,
      DOB: payload.dob,
      REVENUE: payload.revenue,
      "AMOUNT REQUESTED": payload.amountRequested,
      CREATEDAT: payload.createdAt,
      "STATEMENT(A)": payload.statement1,
      "STATEMENT(B)": payload.statement2,
      "STATEMENT(C)": payload.statement3,
      "STATEMENT(D)": payload.statement4,
    }, 0);
    res.status(200).json({ leadId: result.leadId, status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "USFA intake failed";
    res.status(400).json({ error: message, field: "payload" });
  }
});

export default router;