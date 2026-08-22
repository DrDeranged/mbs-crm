import pg from "pg";

const { Client } = pg;

const allStatesExceptYesProhibited = [
  "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL", "IN",
  "IA", "KS", "KY", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE",
  "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const lenders = [
  {
    name: "Alliance Funding Group (AFG)",
    programTypes: ["working_capital", "equipment"],
    minAmount: 10_000,
    maxAmount: 500_000,
    minCreditScore: 600,
    acceptedIndustries: [],
    minTimeInBusinessMonths: 48,
    acceptedStates: [],
    maxExistingPositions: 0,
    priorityWeight: 8,
    contactName: "Atalie Daniel",
    contactEmail: "adaniel@afg.com",
    notes: "Equipment app-only $50K–$500K, FICO 600+, PayNet 620+, rates 8.25–23%, all contract types. WC app-only to $300K (to $3MM w/ financials): FICO 670+, 4+ yrs TIB, $20K+ avg monthly deposits (3 mo stmts), weekly payback ≤15 mo, factor 1.09–1.21, no concurrent WC positions, no negative days, no BKs, 2% origination. Tiers: Platinum 720/670, Gold 675/660, Silver 650/650. Mid-market $500K–$50MM w/ full financials. Restricted: cannabis, law, adult, vending, gaming, staffing, used car (non-franchise), MSB, RE agents, vape, collections, pawn; equipment adds tow trucks (towing cos), med-spa lasers, motorcoaches, used high-tech, Penske/Ryder. Transportation: 5 yrs TIB + 5 trucks + homeowner. Also: Tyson Garrett 714-453-3687, Ashley Bradburn 603-422-6618.",
  },
  {
    name: "AMUR Equipment Finance",
    programTypes: ["equipment"],
    minAmount: 10_000,
    maxAmount: 750_000,
    minCreditScore: 620,
    acceptedIndustries: [],
    minTimeInBusinessMonths: 24,
    acceptedStates: [],
    maxExistingPositions: 10,
    priorityWeight: 7,
    contactName: "Blake Anderson, CLFP",
    contactEmail: "BRAnderson@goamur.com",
    notes: "Tiers: A 700+ FICO/660 PayNet to $350K app-only 5+yrs TIB; B 660/640 to $250K 2+yrs; C 620/620 to $125K 2+yrs. New business (<2yrs) $60K cap, 20% down, 700+ + homeowner. 7 yrs bureau + 7 tradelines required. Construction Vendor Program to $750K app-only (Top Tier 700+/10yrs/680 PayNet); Specialty Vehicle mirrors tiers (metals/mining, recycling, environmental, facilities). Commission ≤15pts <$150K, 8pts above. Zero-down std. Onboarding: 3 lending references. 308-398-4167.",
  },
  {
    name: "Y.E.S. Leasing",
    programTypes: ["equipment"],
    minAmount: 10_000,
    maxAmount: 300_000,
    minCreditScore: null,
    acceptedIndustries: [],
    minTimeInBusinessMonths: 0,
    acceptedStates: allStatesExceptYesProhibited,
    maxExistingPositions: 10,
    priorityWeight: 4,
    contactName: "Bobby",
    contactEmail: "bobby@yesleasing.com",
    notes: "NO credit minimum — sub-500 FICO OK; decline-salvage lane. Qualifier = revenue-to-cost: <$100K equip needs monthly rev ≥30% of cost; ≥$100K needs 50%. Advance 10–20%. Non-citizens OK. Yellow iron + vocational trucks + income-generating equipment ($10K–$150K, $75K max medical). Dump truck caps: Class 8 $85K new/$55K used <750K mi. Sale-leaseback ≥$65K value ≤50% LTV. Story Program: interview + $500 refundable deposit. PROHIBITED: towing, recycling/salvage, restaurants+equipment, oil&gas, OTR trucks/transportation trucks. PROHIBITED STATES: LA, HI, AK. Submit: apps@yesleasing.com cc bobby@.",
  },
  {
    name: "Financial Pacific Leasing (FINPAC)",
    programTypes: ["equipment"],
    minAmount: 10_000,
    maxAmount: 200_000,
    minCreditScore: null,
    acceptedIndustries: [],
    minTimeInBusinessMonths: 0,
    acceptedStates: [],
    maxExistingPositions: 10,
    priorityWeight: 5,
    contactName: null,
    contactEmail: "finpac@finpac.com",
    notes: "Small-ticket tiers by TIB: 0–2yrs → $45K, 3–4yrs → $50K, 5+yrs → $200K. Pricing 7.25%–35%. Trucking restricted; laser equip = licensed MDs/day spas only. $250K/quarter minimum volume commitment.",
  },
];

const columns = [
  "name",
  "program_types",
  "min_amount",
  "max_amount",
  "min_credit_score",
  "accepted_industries",
  "min_time_in_business_months",
  "accepted_states",
  "max_existing_positions",
  "priority_weight",
  "contact_name",
  "contact_email",
  "notes",
  "is_active",
];

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [874239]);

  for (const lender of lenders) {
    const values = [
      lender.name,
      lender.programTypes,
      lender.minAmount,
      lender.maxAmount,
      lender.minCreditScore,
      lender.acceptedIndustries,
      lender.minTimeInBusinessMonths,
      lender.acceptedStates,
      lender.maxExistingPositions,
      lender.priorityWeight,
      lender.contactName,
      lender.contactEmail,
      lender.notes,
      true,
    ];
    const existing = await client.query(
      "SELECT id FROM lenders WHERE name = $1 FOR UPDATE",
      [lender.name],
    );

    if (existing.rowCount > 0) {
      const assignments = columns.slice(1).map((column, index) => (
        column === "contact_email"
          ? `${column} = COALESCE($${index + 2}, ${column})`
          : `${column} = $${index + 2}`
      ));
      await client.query(
        `UPDATE lenders SET ${assignments.join(", ")}, updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id, ...values.slice(1)],
      );
      console.log(`updated ${lender.name} (#${existing.rows[0].id})`);
    } else {
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
      const inserted = await client.query(
        `INSERT INTO lenders (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        values,
      );
      console.log(`inserted ${lender.name} (#${inserted.rows[0].id})`);
    }
  }

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}