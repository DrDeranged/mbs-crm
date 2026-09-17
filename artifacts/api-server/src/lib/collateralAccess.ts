export type CollateralActor = {
  id: number;
  role: string;
};

export type CollateralTemplateVisibility = {
  status: string;
};

export type CollateralLeadRecipient = {
  assignedRepId: number | null;
};

export function canReadCollateralTemplate(
  actor: CollateralActor,
  template: CollateralTemplateVisibility,
): boolean {
  return actor.role === "admin" || template.status === "published";
}

export function canManageCollateralTemplates(actor: CollateralActor): boolean {
  return actor.role === "admin";
}

export function canRenderCollateralForRep(actor: CollateralActor, repId: number): boolean {
  return actor.role === "admin" || actor.id === repId;
}

export function canEmailCollateralToLead(
  actor: CollateralActor,
  lead: CollateralLeadRecipient,
): boolean {
  return actor.role !== "rep" || lead.assignedRepId === actor.id;
}