import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.DATABASE_URL ??= "postgresql://integration-test.invalid/test";

test("deal labels retain unlinked business names without exposing private linked identities or numbers", async () => {
  const { dealIdentityLabel } = await import("../routes/deals");
  assert.equal(dealIdentityLabel({ leadId: null, dealName: "  Existing Business LLC  " }), "Existing Business LLC");
  assert.equal(dealIdentityLabel({ leadId: null, dealName: "Deal #148" }), "No lead linked");
  assert.equal(dealIdentityLabel({ leadId: null, dealName: " " }), "No lead linked");
  assert.equal(dealIdentityLabel({ leadId: 81, dealName: "Private stored business" }), "Lead details unavailable");
  assert.equal(dealIdentityLabel({ leadId: 81, dealName: "Stale business label" }, {
    companyName: "Current Lead Company", contactName: "Jane Smith",
  }), "Current Lead Company — Jane Smith");
  assert.equal(dealIdentityLabel({ leadId: 81, dealName: "Stale business label" }, {
    companyName: null, contactName: null,
  }), "Contact not recorded");
});

test("rep deal-name search requires an unlinked deal or ownership of its linked lead", async () => {
  const { dealSearchCondition } = await import("../routes/deals");
  const dialect = new PgDialect();
  const rep = dialect.sqlToQuery(dealSearchCondition("Private stored name", { id: 7, role: "rep" })!);
  assert.match(rep.sql, /assigned_rep_id/);
  assert.match(rep.sql, /"lead_id" is null/i);
  assert.equal(rep.params.includes("%Private stored name%"), true);
  const manager = dialect.sqlToQuery(dealSearchCondition("Private stored name", { id: 2, role: "manager" })!);
  assert.doesNotMatch(manager.sql, /assigned_rep_id/);
});

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

test("manager and admin contact projections do not apply rep ownership restrictions", async () => {
  const { getAuthorizedDealLeadContacts } = await import("../routes/deals");
  for (const role of ["manager", "admin"] as const) {
    let whereClause: any;
    const database = {
      select() {
        return { from() { return this; }, leftJoin() { return this; },
          async where(where: any) { whereClause = where; return []; } };
      },
    };
    await getAuthorizedDealLeadContacts([{ id: 1, leadId: 81 }], { id: 7, role } as any, database as any);
    assert.doesNotMatch(new PgDialect().sqlToQuery(whereClause).sql, /assigned_rep_id/);
  }
});