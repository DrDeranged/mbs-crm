import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  adminAuditLogTable,
  db,
  insertPartnerContactSchema,
  lendersTable,
  partnerContactsTable,
} from "@workspace/db";
import { requireUser } from "../lib/authHelpers";

const router: IRouter = Router();
const idSchema = z.coerce.number().int().positive();

function canEdit(role: string): boolean {
  return role === "admin" || role === "manager" || role === "rep";
}

router.get("/partners/:partnerId/contacts", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const partnerId = idSchema.safeParse(req.params.partnerId);
  if (!partnerId.success) return void res.status(400).json({ error: "Invalid partner id" });
  const contacts = await db
    .select()
    .from(partnerContactsTable)
    .where(eq(partnerContactsTable.partnerId, partnerId.data));
  res.json(contacts);
});

router.post("/partners/:partnerId/contacts", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!canEdit(user.role)) return void res.status(403).json({ error: "Forbidden" });
  const partnerId = idSchema.safeParse(req.params.partnerId);
  if (!partnerId.success) return void res.status(400).json({ error: "Invalid partner id" });
  const partner = await db.select({ id: lendersTable.id }).from(lendersTable).where(eq(lendersTable.id, partnerId.data));
  if (!partner.length) return void res.status(404).json({ error: "Partner not found" });
  const parsed = insertPartnerContactSchema.safeParse({ ...req.body, partnerId: partnerId.data, createdBy: user.id });
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const [contact] = await db.insert(partnerContactsTable).values(parsed.data).returning();
  await db.insert(adminAuditLogTable).values({
    actorUserId: user.id,
    action: "partner_contact.created",
    entityType: "partner_contact",
    entityId: String(contact.id),
    details: { partnerId: partnerId.data, role: contact.role },
  });
  res.status(201).json(contact);
});

router.patch("/partners/:partnerId/contacts/:contactId", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!canEdit(user.role)) return void res.status(403).json({ error: "Forbidden" });
  const partnerId = idSchema.safeParse(req.params.partnerId);
  const contactId = idSchema.safeParse(req.params.contactId);
  if (!partnerId.success || !contactId.success) return void res.status(400).json({ error: "Invalid id" });
  const parsed = insertPartnerContactSchema.partial().omit({ partnerId: true, createdBy: true }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: parsed.error.message });
  const [contact] = await db.update(partnerContactsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(partnerContactsTable.id, contactId.data), eq(partnerContactsTable.partnerId, partnerId.data)))
    .returning();
  if (!contact) return void res.status(404).json({ error: "Contact not found" });
  await db.insert(adminAuditLogTable).values({
    actorUserId: user.id,
    action: "partner_contact.updated",
    entityType: "partner_contact",
    entityId: String(contact.id),
    details: { partnerId: partnerId.data, fields: Object.keys(parsed.data) },
  });
  res.json(contact);
});

router.delete("/partners/:partnerId/contacts/:contactId", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!canEdit(user.role)) return void res.status(403).json({ error: "Forbidden" });
  const partnerId = idSchema.safeParse(req.params.partnerId);
  const contactId = idSchema.safeParse(req.params.contactId);
  if (!partnerId.success || !contactId.success) return void res.status(400).json({ error: "Invalid id" });
  const [contact] = await db.delete(partnerContactsTable)
    .where(and(eq(partnerContactsTable.id, contactId.data), eq(partnerContactsTable.partnerId, partnerId.data)))
    .returning();
  if (!contact) return void res.status(404).json({ error: "Contact not found" });
  await db.insert(adminAuditLogTable).values({
    actorUserId: user.id,
    action: "partner_contact.deleted",
    entityType: "partner_contact",
    entityId: String(contact.id),
    details: { partnerId: partnerId.data },
  });
  res.sendStatus(204);
});

export default router;