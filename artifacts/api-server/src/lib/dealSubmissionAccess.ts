/** Deal-submission metadata follows the documented deal read boundary. */
export function canReadDealSubmissions(
  user: { id: number; role: string },
  deal: { assignedTo: number | null },
) {
  return user.role === "admin" || user.role === "manager"
    || (user.role === "rep" && deal.assignedTo === user.id);
}
