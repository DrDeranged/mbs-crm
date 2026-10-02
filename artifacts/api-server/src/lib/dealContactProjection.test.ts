import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

test("deal contact projection scopes reps to their linked-lead ownership in one batch", async () => {
  const { getAuthorizedDealLeadContacts } = await import("../routes/deals");
  let selectCalls = 0;
  let whereClause: any;
  const database = {
    select() {
      selectCalls++;
      return {
        from() {
          return this;
        },
        leftJoin() {
          return this;
        },
        async where(where: any) {
          whereClause = where;
          return [{
            leadId: 81,
            firstName: "John",
            lastName: "Smith",
            companyName: " Godspeed Logistics ",
            relatedCompanyName: null,
            contactEmail: "john@example.com",
            contactPhone: "555-0100",
            status: "funded",
            assignedRepId: 7,
            address: "1 Main St",
            city: "Austin",
            state: "TX",
            zip: "78701",
          }];
        },
      };
    },
  };
  const contacts = await getAuthorizedDealLeadContacts(
    [{ id: 901, leadId: 81 }, { id: 902, leadId: 81 }, { id: 903, leadId: 82 }],
    { id: 7, role: "rep" } as any,
    database as any,
  );

  const compiled = new PgDialect().sqlToQuery(whereClause);
  assert.match(compiled.sql, /assigned_rep_id/);
  assert(compiled.params.includes(7));
  assert.equal(selectCalls, 1);
  assert.equal(contacts.size, 1);
  assert.equal(contacts.get(81)?.entityLabel, "Godspeed Logistics — John Smith");
  assert.equal(contacts.get(81)?.businessAddress, "1 Main St, Austin, TX, 78701");
  assert.equal("ein" in (contacts.get(81) ?? {}), false);
  assert.equal("annualRevenue" in (contacts.get(81) ?? {}), false);
});