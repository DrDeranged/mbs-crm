/**
 * Verified lender seed data from the two-lender request.
 *
 * This is deliberately separate from lib/db/seed-lenders.mjs. That script is
 * the original four-lender seed and is kept byte-for-byte unchanged.
 */
const ALL_US_STATES = Object.freeze([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY",
] as const);
const YES_ACCEPTED_STATES = Object.freeze([
  "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL",
  "IN", "IA", "KS", "KY", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WY",
] as const);

export const EXISTING_LENDER_UPDATE_MARKER = "2026-09-14 packet update";
export const BATCH_2_LENDER_UPDATE_MARKER = "2026-09-15 packet update";

export interface ExistingLenderMatchingBaseline {
  programTypes: readonly string[];
  minAmount: number | null;
  maxAmount: number | null;
  minCreditScore: number | null;
  minTimeInBusinessMonths: number | null;
  acceptedIndustries: readonly string[];
  acceptedStates: readonly string[];
}

/**
 * Targeted updates from the 2026-09-14 packet. These are deliberately kept
 * separate from NEW_LENDER_SEEDS: an existing lender's contacts and all
 * unlisted fields must remain untouched when this packet is applied.
 */
export const EXISTING_LENDER_UPDATES = Object.freeze([
  Object.freeze({
    name: "Alliance Funding Group (AFG)",
    marker: EXISTING_LENDER_UPDATE_MARKER,
    notes: `2026-09-14 packet update

SOURCE STATEMENTS (verbatim):
WORKING CAPITAL (Premium WC, app-only to $300k; up to $3MM with financials): terms 6–15 mo, weekly payback, 2% origination; grades Platinum 720+ FICO/670 PayNet (1.09–1.14), Gold 675+/660+ (1.09–1.18), Silver 650+/650+ (1.15–1.21, max 12 mo); MINIMUM 4 YEARS TIB; 3 months banks showing $20k+ avg monthly deposits; no negative ending-balance days; no prior bankruptcies; no concurrent WC contracts; open positions case by case, must net ≥50% if paying off one loan; principal-only payoff after 14 weeks. Commission 8 pts to $150k, 6 pts $151k+ (Silver up to 20). Restricted (WC): cannabis, law offices, adult, vending, gaming, staffing, non-franchise used car dealers, MSBs, real estate agents/brokers, vape, collections, pawn; transportation cautionary — 5 yrs TIB, 5 trucks, homeownership; online retailers, import/export, accounting, financial services also restricted per WC sheet.
EQUIPMENT (app-only $50k–$500k, A–C credits): minimum FICO 600, minimum PayNet Master 620, rates 8.25%–23%, 20-pt commission cap, EFA/$1-out/TRL/FMV. Restricted (EF): cannabis, law offices, adult, tow trucks for towing businesses, med lasers/med spa, vending, gaming, staffing, non-franchise used car dealers, MSBs, real estate agents, vape, collections, pawn, motorcoaches, used high-tech, Penske/Ryder dealers. Cautionary: transportation (5 yrs TIB, 5 trucks, homeownership), oil production, brewery/distillation, food trucks, non-essential equipment, passenger cars, firearms.
Middle market $500k–$50MM+ with full financials.
Contacts: Tyson Garrett VP (714) 453-3687 TGarrett@afg.com; Atalie Daniel (714) 221-1019 adaniel@afg.com (already on file); Ashley Bradburn, Katie Bates. Payoffs: PayoffRequest@afg.com.

SCHEMA MAPPING:
→ Schema: set WC minTimeInBusinessMonths 48 and WC minCreditScore 650 (Silver floor) / EF minCreditScore 600 if the schema supports per-program values; otherwise keep 600/48 and put the split in notes. maxAmount stays 500000 (EF app-only); WC app-only 300000 in notes.`,
    structuredPatch: Object.freeze({
      minCreditScore: 600,
      minTimeInBusinessMonths: 48,
      maxAmount: 500_000,
    }),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["working_capital", "equipment"]),
      minAmount: 10_000,
      maxAmount: 500_000,
      minCreditScore: 600,
      minTimeInBusinessMonths: 48,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: Object.freeze([]),
    }),
  }),
  Object.freeze({
    name: "AMUR Equipment Finance",
    marker: EXISTING_LENDER_UPDATE_MARKER,
    notes: `2026-09-14 packet update

SOURCE STATEMENTS (verbatim):
Broker program tiers: A — app-only to $350k, 700+ FICO, 660+ PayNet, 66% comparable debt, 5+ yrs TIB, no suits/liens/judgments/BK, from 8.25% buy rate, zero down; B — to $250k, 660+ FICO, 640+ PayNet, 50% comp debt, 2+ yrs TIB, from 10.00%; C — to $125k, 620+ FICO, 620+ PayNet, 50% comp debt, 2+ yrs TIB, from 15.75%; NEW BUSINESS (<2 yrs) — max $60k financed, 700+ FICO AND homeownership for all guarantors, 50% comp debt, 20% down or security deposit, ACH mandatory, from 20% with bank statements. All transactions: minimum 7 years in credit bureau and minimum 7 tradelines. Commission: up to 15 pts under $150k, 8 pts $150k+. Specialty Vehicle and Construction Vendor programs exist (tables are images — not extractable; note as "see program sheets"). Submissions: AEFCreditSubmissions@GoAmur.com; 308.398.4140 / 800.994.0016; Grand Island, NE.

SCHEMA MAPPING:
→ Schema: minCreditScore stays 620; minTimeInBusinessMonths stays 24 (0 for New Business program in notes); maxAmount 350000 app-only (current 750000 came from an older packet — confirm with Nate before lowering; leave 750000 and note "app-only cap $350k" unless he confirms).`,
    structuredPatch: Object.freeze({
      minCreditScore: 620,
      minTimeInBusinessMonths: 24,
      maxAmount: 750_000,
    }),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["equipment"]),
      minAmount: 10_000,
      maxAmount: 750_000,
      minCreditScore: 620,
      minTimeInBusinessMonths: 24,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: Object.freeze([]),
    }),
  }),
  Object.freeze({
    name: "Y.E.S. Leasing",
    marker: EXISTING_LENDER_UPDATE_MARKER,
    notes: `2026-09-14 packet update

SOURCE STATEMENTS (verbatim):
2026 guidelines: NO personal credit requirement (funds sub-500 FICO); $10k–$300k; deposit/down 10–20% (general), 25% all dump trucks, 35–50% of cost for yellow iron $10k–$150k; revenue-to-equipment-cost ratio 30% if under $100k, 50% if $100k+ (qualifies 95%+ when met); non-citizens OK; package = signed app within 30 days + 3 months business banks + invoice. Income Generating General Equipment program: $10k–$150k total, medical $75k max, 24–48 mo terms, no private party sales. Dump Truck program: Class 8 $15k min, $85k new / $55k used, <750k mi, ≤10 yrs; Class 6/7 <200k mi, $50k max. Directional drill package max $300k. Higher-tier program: 650+ FICO, 2+ yrs TIB, $15k–$300k, 24–48 mo, ≥$55k monthly revenue. Contact Bobby Cowan (678) 478-0152, bobby@yesleasing.com; submit apps@yesleasing.com cc bobby@.

SCHEMA MAPPING:
→ Schema: no changes to amounts; minCreditScore null (confirm current); add the ratio rule and down-payment schedule to notes.`,
    structuredPatch: Object.freeze({}),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["equipment"]),
      minAmount: 10_000,
      maxAmount: 300_000,
      minCreditScore: null,
      minTimeInBusinessMonths: 0,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: YES_ACCEPTED_STATES,
    }),
  }),
  Object.freeze({
    name: "Dexly Finance",
    marker: BATCH_2_LENDER_UPDATE_MARKER,
    notes: `2026-09-15 packet update

SOURCE STATEMENTS (verbatim):
- Paper types: B to D (was A–D). Positions: NO LIMIT (was 1–5). Funding terms: 6 weeks to 32 weeks. Primary market: all 50 states (Texas first position only), Puerto Rico & Canada. Revenue: minimum $200,000 monthly. Repayment: daily or weekly. Origination fees: 1% to 10%.
- RESTRICTED INDUSTRIES (minimum $1,000,000 monthly revenue): auto dealership (new); construction — general/home remodeling/subcontractor; consulting; energy/oil & gas; hospitality — vacation rentals; IT — software development; law firm; real estate — development/property management; services — staffing; transportation — passenger/trucking; wholesale — food distribution/goods.
- PROHIBITED INDUSTRIES: auto dealership (used); bail bonds; cannabis — dispensary/grower; cash exchange (check cashing/ATM/pawn); collection agency/credit repair; financial services; logistics/import & export; freight brokers; real estate — brokerage; religious services; services — travel agency.
- ISO commission by factor rate: 1.30 = buy rate; 1.31–1.35 = 0.8%–4% of funded amount; 1.36–1.40 = 4.8%–8%; 1.41–1.45 = 8.4%–10%; 1.46–1.50 = 10.4%–12%.
- Submissions to underwriting@dexlyfinance.com cc Relations Manager; all communication in the original thread. Stipulations: application, 3 recent bank statements, accounts receivable, tax return, merchant DL/VC, credit card statement.
- (September 2026 bonus structure PNG is a promotional commission bonus, not criteria — not recorded.)

SCHEMA MAPPING: amounts and TIB are unchanged. Positions are no limit in source statements; the existing schema value is preserved because this is a notes-only update.`,
    structuredPatch: Object.freeze({}),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["working_capital", "MCA"]),
      minAmount: 75_000,
      maxAmount: 5_000_000,
      minCreditScore: null,
      minTimeInBusinessMonths: 12,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: Object.freeze([...ALL_US_STATES, "PR"]),
    }),
  }),
  Object.freeze({
    name: "TimePayment Corp",
    marker: BATCH_2_LENDER_UPDATE_MARKER,
    notes: `2026-09-15 packet update

SOURCE STATEMENTS (verbatim):
- CREDIT TIERS (min–max total funding / yrs in business / FICO / startups? / challenged credit?): AAA $10K–$150K / 10+ / 750+ / no / no; AA $500–$150K / 5+ / 750+ / yes / no; A $500–$150K / 3+ / 725+ / yes / no; O $500–$150K / 2 / 725+ / yes / no; P $500–$50K / 5+ / 650+ / yes / no (personal credit thinner profile); P (start-up) $500–$50K / <2 / 750+ / yes / yes; S $500–$20K / <2 / 675+ / yes / yes; T $500–$20K / <2 / 650+ / yes / yes; Q $500–$10K / <2 / 625+ / yes / yes; U $500–$6K / <2 / 550–625 / yes / yes (bankruptcy history if discharged or dismissed; security deposit may be required). Mortgage or $50K+ loan history required for AAA/AA/A/O/P.
- Up to 15 points per deal on vendor invoice total. Min security deposit 10% for start-ups when approval ≥ $15,000. Personal guarantor required when TIB < 3 years; verifiable owner must be first PG; non-owner relative co-signer considered with 2 paystubs. Soft credit pull via Experian. Corp-only: requests < $10,000 with 3+ yrs TIB; over $10,000 requires 5+ yrs. Start-ups up to $50,000; more with a cross-corporate guaranty (mutual ownership required). Financials (2 yrs business tax returns + 3 months banks) required for CCG offers and requests ≥ $75,000. Site inspections on leases ≥ $50,000. Direct debit required ≥ $10,000.
- Restrictions: consumer, private party sales, sale leasebacks, working capital, permanent fixtures, ATM, POS/bankcard, cannabis, computers & 100% software, copiers, security & monitoring, water quality products. Up to 40% of invoice may be soft costs. Verbal verifications required in New York.
- $1 buyout states (2026): AL, AZ, CO, DE, HI, IN, LA, MD, ME, MO, NC, OH, OK, PA, SD, UT, WI, WY (TX, MA, SC dropped vs earlier guide).
- Contacts: Caitlin Keefe 855-259-1034 caitlin.keefe@timepayment.com; Ian Mayer 866-994-7162 ian.mayer@timepayment.com; brokerdesk@timepayment.com 866-994-7260.

SCHEMA MAPPING: maxAmount is $150,000 because the credit chart caps every tier at $150K total funding; minAmount remains $500. All other criteria remain in source statements.`,
    structuredPatch: Object.freeze({
      maxAmount: 150_000,
    }),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["equipment"]),
      minAmount: 500,
      maxAmount: 150_000,
      minCreditScore: null,
      minTimeInBusinessMonths: 0,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: ALL_US_STATES,
    }),
  }),
  Object.freeze({
    name: "Keystone Equipment Finance Corp (KEF)",
    marker: BATCH_2_LENDER_UPDATE_MARKER,
    notes: `2026-09-15 packet update

SOURCE STATEMENTS (verbatim):
- contract is EFA; prepayment premium .00834 × principal × remaining months; payments due 5th and 20th, 6-day grace; GPS most of the time; comp credit not required but preferred; homeownership not required but preferred; CDL requirement if business < 2 years; hard credit pull; Experian and PayNet (if necessary); minimum TIB none but experience preferred; DEAL BREAKERS: under 500 scores, post-BK delinquency. Equipment Parameters 2025: startups (≤18 mo) sleepers/day cabs 2017+ ≤599k; non-startups 2015+ ≤650k; box/reefer startups 2017+ ≤220k, non-startups 2015+ ≤299k; sprinter 2017+/175k, 2015+/220k; dump 2005+ 599k/650k; flatbed cab&chassis 2017+/220k, 2015+/299k; flatbed pickup & service 2017+/199k, 2015+/250k; trailers dry van/reefer 2017+/2015+ (reefer <20k hrs); flatbed/dropdeck 10 yrs / 15 yrs.

SCHEMA MAPPING: no schema changes.`,
    structuredPatch: Object.freeze({}),
    matchingBaseline: Object.freeze({
      programTypes: Object.freeze(["equipment"]),
      minAmount: 10_000,
      maxAmount: 150_000,
      minCreditScore: 550,
      minTimeInBusinessMonths: 0,
      acceptedIndustries: Object.freeze([]),
      acceptedStates: ALL_US_STATES,
    }),
  }),
] as const);

export type ExistingLenderUpdate = (typeof EXISTING_LENDER_UPDATES)[number];

/**
 * Appends a packet update without normalizing or otherwise rewriting the
 * existing notes. This is intentionally pure so idempotency and preservation
 * can be tested without a database.
 */
export function appendExistingLenderUpdateNotes(
  existingNotes: string | null,
  updateNotes: string,
): string {
  return existingNotes ? `${existingNotes}\n\n${updateNotes}` : updateNotes;
}

/**
 * Applies the structured fields and packet notes for an existing lender.
 * Production maintenance uses this pure helper before persisting its update;
 * keeping the transformation here also lets fixtures exercise that exact
 * update path without connecting to a database.
 */
export function applyExistingLenderUpdate<Row extends { notes: string | null }>(
  existing: Row,
  update: ExistingLenderUpdate,
): Row {
  return {
    ...existing,
    ...update.structuredPatch,
    notes: appendExistingLenderUpdateNotes(existing.notes, update.notes),
  } as Row;
}

export const NEW_LENDER_SEEDS = Object.freeze([
  Object.freeze({
    name: "Dexly Finance",
    programTypes: Object.freeze(["working_capital", "MCA"]),
    minAmount: 75_000,
    maxAmount: 5_000_000,
    minCreditScore: null,
    minTimeInBusinessMonths: 12,
    acceptedStates: Object.freeze([
      "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
      "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
      "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
      "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
      "VT", "VA", "WA", "WV", "WI", "WY", "PR",
    ]),
    contactEmail: "underwriting@dexlyfinance.com",
    notes: `SOURCE STATEMENTS (verbatim):
- Programs: working capital / MCA
- Funding: $75,000 – $5,000,000; terms typically 5–12 months (exceptions
  considered); repayment daily or weekly
- Time in business: minimum 12 months
- Revenue: minimum $200,000 MONTHLY
- Credit: no minimum FICO stated; no bankruptcies; no more than 5 consecutive
  NSF events
- Paper: A–D; Positions: 1–5
- Geography: all 50 US states + Puerto Rico; TEXAS: first position only;
  Canada only w/ US-registered entity (enhanced review)
- Restricted industries: construction, contractors, consulting, logistics,
  trucking, cannabis, restaurants — EXCEPTION: accepted at $1,000,000+ monthly
  revenue
- Pricing (notes): factor rates 1.25–1.50; ISO commission tiers: 1.25–1.30 =
  A-paper 1%; 1.30 buy rate; 1.31–1.35 = 1–5%; 1.36–1.40 = 6–10%; 1.41–1.45 =
  10.4–12%; 1.46–1.50 = 12.4–14%; commissions paid weekly Fridays
- Docs: complete application + last 3 months business bank statements; stips
  may include DL/VC, most recent tax return, AR report, AP report, balance
  sheet, proof of ownership, board resolution if applicable, bank login
- Submission: underwriting@dexlyfinance.com (cc ISO Relations Manager); all deal communication stays in the original email thread
- Notes: approvals within minutes; family-office capital; ISO-only model

SCHEMA MAPPING:
- Mapped: working_capital and MCA programs, $75,000–$5,000,000 amount range,
  12-month minimum TIB, 1–5 position maximum, all 50 US states and Puerto
  Rico, and the stated underwriting email.
- Unsupported by the existing lender schema and retained above: terms and
  repayment cadence, monthly revenue, no-bankruptcy and NSF rules, paper
  grade, Texas first-position rule, Canadian enhanced-review rule,
  restricted industries and revenue exception, pricing and commission tiers,
  documentation/stips, ISO Relations Manager CC rule, original-thread rule,
  and the approval/funding model.`,
  isActive: true,
  acceptedIndustries: Object.freeze([]),
  maxExistingPositions: 5,
}),
  Object.freeze({
    name: "Thoro Corp",
    programTypes: Object.freeze(["working_capital", "MCA"]),
    minAmount: 80_000,
    maxAmount: 5_000_000,
    minCreditScore: 500,
    minTimeInBusinessMonths: 6,
    acceptedStates: Object.freeze([]),
    notes: `SOURCE STATEMENTS (verbatim):
- Programs: working capital / MCA
- Funding: $80,000 – $5,000,000; terms 30–180 days; repayment daily or weekly
- Time in business: minimum 6 months
- Credit: minimum FICO 500; previous defaults accepted if settled; maximum 3
  negative days per month
- Paper: B–D
- Positions & revenue by risk tier: LOW-RISK industries: 1st position and up,
  minimum revenue $100,000/mo, minimum 10 deposits/mo; HIGH-RISK industries:
  2nd position and up, minimum revenue $150,000/mo, minimum 20 deposits/mo
- Geography/industries: NO industry restrictions, NO state restrictions
- Docs (contract request): driver's license, voided check, email, phone —
  for EVERY owner if multiple; closing stips before bank verification: proof
  of ownership (most recent tax return / EIN letter / K1), most recent AR
  report or invoices, credit card statements if applicable
- Notes: B–D paper lane; accepts previously defaulted merchants if settled

SCHEMA MAPPING:
- Mapped: working_capital and MCA programs, $80,000–$5,000,000 amount range,
  6-month minimum TIB, and minimum FICO 500.
- Unsupported by the existing lender schema and retained above: terms and
  repayment cadence, previous-default settlement rule, negative-days rule,
  paper grade, risk-tier position rules, monthly revenue and deposit
  requirements, documentation/stips, and the no-restrictions geography and
  industry statements.
- Thoro's risk-tier position rules do not map to one maxExistingPositions
  value; no maximum position was supplied, so the schema-required default
  applies.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "Navitas Credit Corp",
    programTypes: Object.freeze(["equipment"]),
    minAmount: 10_000,
    maxAmount: 350_000,
    minCreditScore: 660,
    minTimeInBusinessMonths: 24,
    acceptedStates: Object.freeze([...ALL_US_STATES, "DC"]),
    contactEmail: "myapplications@navitascredit.com",
    notes: `SOURCE STATEMENTS (verbatim):
- programTypes: ["equipment"]
- minAmount: 10000 | maxAmount: 350000 (app-only; commercial program $250k–$500k with financials; $500k–$2.5MM+ call)
- minCreditScore: 660 (Bronze tier floor; Silver 675, Gold 700, Platinum 725)
- minTimeInBusinessMonths: 24 (Bronze/Silver at $10k–$75k; higher tiers/amounts need 36–60; Start-Up program 0–24 mo see notes)
- acceptedStates: all 50 + DC (not stated otherwise)
- contactEmail: "myapplications@navitascredit.com"
- Tiers: Platinum 725 CBR / 5 yrs TIB / $10k–$250k; Gold 700 / 3–5 yrs by size ($10k–$75k 3y, $75k–$150k 4y, $150k–$250k 5y); Silver 675 / 2–4 yrs; Bronze 660 / 2–4 yrs, max $125k.
- Comparable business credit: Platinum/Gold 100% of request; Silver/Bronze >75% (Bronze preferred). "CompLight" program allows exceptions up to $75k with 10–20% down/first payment.
- Rates (Aug 2026): Platinum 8.50%, Gold 9.50%, Silver 10.75%, Bronze 12.00%; <24-mo terms +100 bps; repeat customers −25 bps; commercial $250k–$500k 8.00%.
- Fees: app-only doc fee $250; commercial/franchise $300; titled deal fee $400 (incl. doc fee); wire $35, ACH free.
- Max commission by financed amount: $10k–$50k 15 pts; $50k–$100k 12; $100k–$150k 10; $150k–$250k 8; $250k+ 6.
- Bank statements: 3 months generally required at $75k+ (low-med 5-figure avg balance). Mortgage: clean history generally required at $50k+. ACH preferred.
- Start-Up Business Program (0–2 yrs TIB): $10k–$50k, titled equipment and yellow iron only; 20% upfront (down payment or 1st payment); 700+ CBR; medium 4-figure avg balance; homeownership preferred; prior industry experience required; 17.00% buy rate; ACH mandatory; restaurants/food service and churches not permitted.
- Medical Program: app-only to $350k; 2 yrs licensed accepted in lieu of TIB; 680 CBR; MDs/dentists/specialists/surgeons; med spas and wellness centers restricted.
- Corp-only: 5+ yrs TIB, 70+ Paydex with comparable corp-only borrowing, no suits/liens/judgments/BK; closely-held ownership 10+ yrs.
- Restricted industries (most common): adult entertainment, agriculture, cannabis, consultants/financial advisors, forestry/lumber/logging, gaming/gambling, mining, oil & gas, real estate/mortgage, security/commodity brokers, spas/medi spas (beauty salons OK), tanning, TRUCKING LONG-DISTANCE, vendor route operators.
- Restricted equipment: ATMs, boats/planes, copiers, drones, refinances, expendables, food trucks/trailers, inventory, gaming devices, ice cream/yogurt machines, lasers, microdermabrasion, red light, residual financing, sale-leasebacks over 60 days, solar panels, tanning beds, used IT. Titled: long-distance sleepers, dry vans/reefer trailers, RVs/ATVs, personal autos, taxis/rental cars, rebuilt/salvage titles restricted; local service/delivery/vocational vehicles and medium/heavy trucks acceptable.
- UCC filed at $35k+. Site inspections on private-party titled transactions. Second Glance program: declines can be re-presented with rate/down/guarantor enhancements.
- Address: 201 Executive Center Drive, Suite 285, Columbia, SC 29210; P 803-566-8245; credit dept mycredit@navitascredit.com. Submit via broker portal when possible.

SCHEMA MAPPING:
- Mapped: equipment, $10,000–$350,000, minCreditScore 660, TIB 24, all 50 states + DC, and myapplications@navitascredit.com.
- contactName was not stated; no name is inferred.
- minCreditScore 660 is the Bronze tier floor; minTimeInBusinessMonths 24 is the Bronze/Silver minimum. The higher-tier, commercial, Start-Up, Medical, and Corp-only values remain in SOURCE STATEMENTS because they do not map to one lender-level value.
- Unsupported and retained above: app-only/commercial/call amount distinctions, tier rules, comparable business credit, CompLight, rates, fees, commissions, bank-statement and mortgage rules, Start-Up Business Program, Medical Program, Corp-only rules, restricted industries, restricted equipment, UCC/site-inspection/Second Glance rules, and address/phone/credit-department/portal details.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "Keystone Equipment Finance Corp (KEF)",
    programTypes: Object.freeze(["equipment"]),
    minAmount: 10_000,
    maxAmount: 150_000,
    minCreditScore: 550,
    minTimeInBusinessMonths: 0,
    acceptedStates: ALL_US_STATES,
    contactName: "Jake Gothers",
    contactEmail: "jgothers@keystoneefc.com",
    notes: `SOURCE STATEMENTS (verbatim):
- programTypes: ["equipment"]
- minAmount: 10000 | maxAmount: 150000 (marketing deck says to $250k; credit guidelines say max $150k — use 150000, note the discrepancy)
- minCreditScore: 550
- minTimeInBusinessMonths: 0 (startups accepted with ≥1 year industry experience)
- acceptedStates: all 50 (not stated otherwise)
- contactEmail: "jgothers@keystoneefc.com"
- Direct, independent lender; transportation, construction, arbor, waste; all credit profiles and start-ups considered; in-house underwriting; does not broker or sell loans.
- Minimum FICO 550. Startups: at least a year of industry experience.
- Bank statements: month-end balance should exceed the equipment payment; most customers with 3-figure bank statements will be declined. Tax returns needed for total finance amount > $70k or to prove ownership.
- Down payment: startups minimum 30%; non-startups typically 20% subject to equipment valuation; 50% for a company under 2 yrs old without a CDL (CDL-required trucks only).
- GPS usually required; always for startups, low credit scores, higher-ticket transactions.
- Work-authority drivers (temporary/non-domiciled CDL, work visa): green card or E2 required depending on expiry; contract term must be shorter than remaining CDL/visa time.
- Equipment parameters: OTR sleepers/day cabs ≤10 yrs & ≤650k mi; box/reefer ≤10 yrs & ≤250k; sprinter ≤10 yrs & ≤175k; dump trucks ≤20 yrs & ≤650k; flatbed cab&chassis / tow ≤10 yrs & ≤250k; flatbed pickup / service trucks ≤10 yrs & ≤175k; trailers ≤10 yrs (reefer ≤20k hrs). Construction: excavators/dozers/loader backhoes ≤20 yrs (non-startups only, startups NO); mini-ex/skid steers/chippers ≤10 yrs.
- NO: rebuilds/reconditioned, glider kits, salvaged/branded titles, working capital, refinance, private sellers.
- Docs via DocuSign; POA forms need wet signature. Early payout premium = principal × 0.00834 × remaining months.
- Contact: Jake Gothers, Financial Representative, 860-216-9874, www.keystoneefc.com. Submission: completed credit application + last 3 months bank statements + equipment description/invoice.

SCHEMA MAPPING:
- Mapped: equipment, $10,000–$150,000, minCreditScore 550, TIB 0, all 50 states, contactName Jake Gothers, and jgothers@keystoneefc.com.
- The marketing deck says to $250k; credit guidelines say max $150k — use 150000, note the discrepancy.
- TIB 0 maps the stated startup eligibility; startup industry experience remains in SOURCE STATEMENTS.
- No working_capital program is mapped: NO: rebuilds/reconditioned, glider kits, salvaged/branded titles, working capital, refinance, private sellers.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "Channel Partners Capital",
    programTypes: Object.freeze(["working_capital", "equipment"]),
    minAmount: 10_000,
    maxAmount: 400_000,
    minCreditScore: 600,
    minTimeInBusinessMonths: 12,
    acceptedStates: ALL_US_STATES,
    contactEmail: "newdeals@channelpartnersllc.com",
    notes: `SOURCE STATEMENTS (verbatim):
- programTypes: ["working_capital", "equipment"]
- minAmount: 10000 (WC) / 15000 (EF) — use 10000, note EF floor
- maxAmount: 400000 (WC); EF tier exposure to $250k–$300k
- minCreditScore: 600
- minTimeInBusinessMonths: 12 (WC); EF tiers 24–84
- acceptedStates: all 50 (not stated otherwise)
- contactEmail: "newdeals@channelpartnersllc.com"
- Guidelines dated May/June 2026.
- WORKING CAPITAL: $10k–$400k, terms 6–24 months; minimum annual revenue $175,000; minimum TIB 1 year; minimum FICO 600; BK discharge 2 years with re-established credit; tax liens >$50k must be paid or on payment plan; origination fee 2.5%; commission max 12 pts (Select 8 / Choice 5 / renewals 6 / fundings >$150k 8). Submission: application + most recent 3 months bank statements. Funding: valid DL/passport, voided business check, verification of material ownership; site inspection may be required. Can pay off competing WC loans up to $125k balance if customer retains ≥50% of proceeds.
- EQUIPMENT FINANCE tiers: Tier 1–3 $250k ($300k hard asset), 7+ yrs TIB, 720+ FICO, comp credit $150k+; Tier 4 $150k, 5+ yrs, 700+, $75k+ comp; Tier 5 $100k, 4+ yrs, 660+, $50k+ comp; Tier 6 $75k, 3+ yrs, 620+; Tier 7 $50k, 2+ yrs, 600+. Max term 72 new / 60 used. Age limits: hard asset 20 yrs, titled 15 yrs, other 7 yrs. Min $15k financed; no PPS/fixtures/high-risk assets on tiers 5–7.
- TRANSPORTATION: long haul — fleet 10+, 6+ yrs TIB; local — fleet 2+, 4+ yrs TIB; preferred FICO 700+; comp credit 50% of request; max $150k; liability insurance on titled vehicles.
- EF fees: origination $199 (<$50k) / $299 (>$50k); prefunding $100; wire $35; site inspection $195; lien search $50/entity; titling $300/asset. EF commission: <$75k 15 pts; $75k–$100k 10; >$100k 8.
- Restricted industries: adult, credit service/collection/repo, day trading, financial services, firearms, gambling, government, insurance, legal services, marijuana/CBD, marinas**, mining, money service, mobile home dealers, MLM, non-profit**, oil, political orgs, precious metals, religious**, tanning**, tattoo/massage, tax prep**, vape (** = exception basis). Restricted equipment: non-essential, aircraft, aesthetic lasers, ATMs*, boats, copiers/printers, gaming, invasive medical, leasehold improvements*, agriculture equipment.
- Address: 10900 Wayzata Blvd Ste 300, Minnetonka, MN 55305; (763) 746-7760; submissions via Partner Portal.

SCHEMA MAPPING:
- Mapped: working_capital and equipment programs, $10,000–$400,000 amount range, minCreditScore 600, WC minimum TIB 12, all 50 states, and newdeals@channelpartnersllc.com.
- contactName was not stated; no name is inferred.
- EF minAmount is $15,000 and EF tier exposure is $250k–$300k; the lender-level amount mapping uses the WC $10,000–$400,000 range.
- EF tiers 24–84 months TIB and all other program-specific values remain in SOURCE STATEMENTS because the schema has one lender-level credit, TIB, and amount value.
- Unsupported and retained above: terms, revenue, credit-recovery rules, tax-lien rules, fees, commissions, submission/funding documents, payoff rules, EF tiers, transportation rules, asset ages, restricted industries/equipment, address/phone, and portal.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "TimePayment Corp",
    programTypes: Object.freeze(["equipment"]),
    minAmount: 500,
    maxAmount: 1_500_000,
    minCreditScore: null,
    minTimeInBusinessMonths: 0,
    acceptedStates: ALL_US_STATES,
    contactEmail: "brokerdesk@timepayment.com",
    notes: `SOURCE STATEMENTS (verbatim):
- programTypes: ["equipment"]
- minAmount: 500 | maxAmount: 1500000
- minCreditScore: null (proprietary scoring, "challenged to well qualified", startups considered)
- minTimeInBusinessMonths: 0 (startups; 'O' score 2+ yrs; A 3+, AA 5+, AAA 10+)
- acceptedStates: all 50 ($1 buyout only in AL AZ CO DE FL HI IN LA ME MD MA MO NC OH OK PA SC SD TX UT WI WY; KS and NY guarantors FMV-only)
- contactEmail: "brokerdesk@timepayment.com"
- Boston FinTech, 30+ yrs, 100k+ active accounts; leases $500–$1.5MM+; terms 12–60 months; instant credit decisions up to $25k; personal-guarantee and corp-only accepted; commercial only.
- Products: FMV lease, Lease with Purchase Option (3 payments buyout), $1 Buyout (AAA/AA/A credits, listed states only).
- Credit scores: AAA 10+ yrs TIB and $10k min equipment cost; AA 5+ yrs; A 3+ yrs; 24-mo AA/A require $5k min equipment cost; 'O' score 2+ yrs and funded to $150k+.
- Build commission into the requested amount (Equipment + Commission = Requested Funding). Min processing fee $125. Site inspections on leases > $50k. Direct debit required on leases ≥ $10k. Startups: 10% security deposit may be required.
- Excluded industries: ATM and bankcard, cannabis, computers and 100% software, copiers, security and monitoring, water quality products.
- Portal: InfoHub (quotes, eSign, tracking). 866-994-7260. The seeded deal "TP K1 Speed" was funded through TimePayment.

SCHEMA MAPPING:
- Mapped: equipment, $500–$1,500,000, minCreditScore null, TIB 0, all 50 states, and brokerdesk@timepayment.com.
- contactName was not stated; no name is inferred.
- minCreditScore is null because proprietary scoring is stated and no credit minimum is stated; no credit minimum is inferred.
- TIB 0 maps startups being considered; the 'O', A, AA, and AAA TIB tiers remain in SOURCE STATEMENTS.
- Unsupported and retained above: lease/product types, score tiers, terms, account/company history, commission treatment, fees, inspection/direct-debit/security-deposit rules, excluded industries, portal/phone, and the seeded-deal statement.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "PEAC Solutions",
    programTypes: Object.freeze(["equipment", "working_capital"]),
    minAmount: 10_000,
    maxAmount: 250_000,
    minCreditScore: 640,
    minTimeInBusinessMonths: 24,
    acceptedStates: ALL_US_STATES,
    contactName: "Elena Zucchi",
    contactEmail: "ezucchi@PEACsolutions.com",
    notes: `SOURCE STATEMENTS (verbatim):
- programTypes: ["equipment", "working_capital"]
- minAmount: 10000 | maxAmount: 250000 (app-only; $150k standard / $250k "A" credits)
- minCreditScore: 640 (Vantage; 620 with Structured Finance Program in some states)
- minTimeInBusinessMonths: 24 (under $30k; scales to 120 mo at $150k–$250k — see grid)
- acceptedStates: all 50 (SFP not available in all states due to usury laws)
- contactEmail: "ezucchi@PEACsolutions.com"
- App-only grid (with PG): <$30k: TIB 2y, Vantage 640, >25% revolving available, Paydex 65; $30k–$50k: 3–4y, 660, >25%; $50k–$75k: 5y, 680, >50% revolving, 10 employees, comp debt; $75k–$100k: 7y, 680; $100k–$150k: 8y, 680; $150k–$250k: 10y, 700, Paydex 70. Comp debt = commercial tradelines ≥50% of request, required at $50k+ or corp-only.
- Corp-only grid: <$30k 3–4y TIB, CCS 425, SBRI 820; up to $150k–$250k 10y, 500, 850, Paydex 70, 30 employees.
- Personal credit: 5+ yrs from BK/foreclosure discharge; at least 3 tradelines; fewer than 10 inquiries.
- Structured Finance Program: 1–2 yrs TIB → $20k max, 36-mo max term, 620 Vantage, 2 advance payments, 3 months banks, ACH; 2nd Chance (2+ yrs TIB) $10k–$50k, 36–60 mo; 16% rate.
- Points: $10k–$50k 15; $50k–$75k 12; $75k–$100k 10; $100k+ 8. Doc fee $125 (≤$50k) / $150 / $250 / $350 titled; prefund $100; wire $40, ACH free.
- Working capital program: exists per cover (Elena Zucchi, 856-505-4402) — WC criteria not in the extracted pages; mark WC "criteria pending" in notes and do not set WC-specific minimums.
- Approved asset types: broad (air compressors through vending); restricted list per manual.

SCHEMA MAPPING:
- Mapped: equipment and working_capital programs, $10,000–$250,000 amount range, minCreditScore 640, TIB 24, all 50 states, contactName Elena Zucchi, and ezucchi@PEACsolutions.com.
- minAmount 10000, maxAmount 250000, minCreditScore 640, and TIB 24 map the lender-level app-only values. The Structured Finance Program credit value 620 and the $150k standard/$250k "A" credits distinction remain in SOURCE STATEMENTS.
- Working capital criteria are not stated: WC criteria pending and no WC-specific minimums are set; no WC minimum is inferred.
- Unsupported and retained above: app-only credit grid, corp-only grid, personal-credit rules, Structured Finance Program, points, fees, WC contact phone, approved assets, and restricted-list detail.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "Luminar Capital",
    programTypes: Object.freeze(["working_capital", "MCA"]),
    minAmount: 5_000,
    maxAmount: 150_000,
    minCreditScore: 500,
    minTimeInBusinessMonths: 12,
    acceptedStates: ALL_US_STATES,
    contactName: "Misha Mikhaylov",
    contactEmail: "partners@luminarcapital.com",
    maxExistingPositions: 4,
    notes: `SOURCE STATEMENTS (verbatim):
- Product: revenue-based financing (purchase of future receipts) and business-purpose loans; every offer can also be structured as a "Luminar Line" (50% max initial draw, $5k minimum draw, 4% origination fee per draw, 30-day cooldown between draws, replenishes as repaid).
- Positions: B paper 2nd–3rd; C paper 3rd–4th. Luminar entertains 1st positions with challenged credit history depending on file variables and total gross receipts %.
- Terms: B paper 6–12 months; C paper 2–6 months. Payment frequency daily/weekly. Funding range $5K–$150K; payoffs must net 50%+.
- Buy rates: B paper 1.25–1.33; C paper 1.34–1.40 (can be lower or higher by risk profile). Upsell up to 12 points. Early prepay discounts as low as a 1.08 buy in the first month; standard prepays on 90d+ offers 15/10/5 off the first 30/60/90 days.
- Processing fees: <$10,000 $99; $10,000–$14,999 $149; $15,000–$49,999 $199; $50,000–$99,999 $399; $100,000–$199,999 $499; $200,000+ $749. No processing fees in California.
- ELIGIBILITY (B paper / C paper): months in business ≥12 / ≥12; credit score ≥550 / ≥500; monthly revenue ≥$15K / ≥$10K; total remit including Luminar's position ≤25% / ≤30%; average negative days per month ≤3 / ≤4; total negative days in 3 months ≤9 / ≤12; average daily balance as % of revenue ≥7.5% / ≥5%; monthly revenue deposit count ≥4 / ≥4.
- AUTO-DECLINE (both papers): bankruptcy in last year; Datamerch default flags or default history; history of financial or egregious criminal filings; late payments on multiple tradelines; prohibited industry; satisfied defaults; primarily cash deposits (Zelle, Cash App, ATM); financings within the last 45 days of funding (open-minded if applicant received less than max approval 30–45 days prior). Background checks performed upfront. Tax liens: open-minded to balances totaling ≤50% of monthly revenue if a payment plan exists.
- RESTRICTED INDUSTRIES (industry auto-decline): adult entertainment; all-cash businesses; auction; bail bonds; check cashing and money wiring; commodity-based (precious metals); cryptocurrencies; debt collection and bankruptcy lawyer; drug paraphernalia; helicopter tours; international businesses; lending or financing firm (equipment finance); lottery and gambling; multi-level marketing; non-profit and religious; solar.
- INDUSTRY RISK CLASSIFICATION: Low risk/preferred — automotive repair/services, education/schools/daycare, equipment/appliance repair, funeral homes, manufacturing, medical/mental health professionals, pharmacies, waste management. Moderate — accounting & tax, cleaning & maintenance, consulting, convenience stores/markets/delis/bakeries, farmers markets, furniture & home furnishings, gyms/fitness, home-healthcare/senior care, insurance brokers, IT services/technology, laundromats, law offices, liquor stores, pet care, restaurants/bars, retail. High risk — advertising agencies, construction, farming & agriculture, firearms/guns/ammunition, gas stations & fuel, jewelry, landscaping & lawn services, limo service, oil and gas, pawn shops, property management/real estate, spas/salons/barbershops, staffing agencies, ticket/concert venues, travel agencies, auto sales, cannabis, trucking & transportation, specialty contractors (electricians, plumbing, HVAC), wholesale/distribution.
- INDUSTRY TIB OVERRIDES: law offices minimum 5 years TIB; construction/general contractor minimum 2 years TIB and minimum 5 monthly deposits; trucking/transportation minimum 3 years TIB, receivables from Amazon, FedEx, or direct customers, cannot have factoring.
- Renewals: eligible at 50% repaid with good payment history; considered as early as 40% repaid with very good payment history.
- Contact: Misha Mikhaylov, CEO, 25 SE 2nd Ave Ste 550-789, Miami, FL 33131; (305) 307-0190; partners@luminarcapital.com. ISO compensation paid within 5 business days of funding; clawback if 2 of first 5 debits return, or default/insolvency/3+ returns within 30 days.

SCHEMA MAPPING: mapped working_capital + MCA, $5,000–$150,000, minCreditScore 500, TIB 12, positions 1–4, contact email. Unsupported and retained above: paper tiers, term ranges, remit/negative-day/ADB/deposit-count rules, auto-decline list, restricted industries, risk classification, TIB overrides, pricing, fees, renewal rules.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "North Mill Equipment Finance (NMEF)",
    programTypes: Object.freeze(["equipment"]),
    minAmount: 15_000,
    maxAmount: 300_000,
    minCreditScore: 550,
    minTimeInBusinessMonths: 0,
    acceptedStates: ALL_US_STATES,
    contactEmail: "apps@nmef.com",
    notes: `SOURCE STATEMENTS (verbatim):
- APPLICATION QUALIFIER / AUTO-DECLINE: FICO min 550; TIB < 2 years requires 640+ FICO; must have 3+ years industry experience; bankruptcy (discharged or dismissed) in last 3 years (5 for startups); charge-off in last 3 years (5 for startups); felony conviction within last 10 years; foreclosure in last 3 years (5 for startups); repossession in last 3 years (5 for startups); NMEF account in collections or poor pay history; no FICO score generated on Experian; tax liens > $5K reviewed case-by-case; ANY late child support payment in last 12 months is an automatic decline.
- Finance amounts: $15K–$300K app only; $15K–$200K app only for startups; $300K+ requires last 2 years audited/reviewed financials or business tax returns plus interim statements.
- STANDARD PRICE CARD A (most equipment): tiers A-1 / A-2 / A-3 — EFA/lease 10.00% / 12.50% / 15.00%; loan 11.00% / 13.75% / 16.50%; LTV titled 150/140/130%, non-titled 175/150/150%; max app-only exposure $300K each; down payment 0% / 0% / 5% or first-and-last; industry experience 5+ / 3+ / 3+ yrs; TIB 5+ / 2+ / 2+ yrs; min FICO 720+ / 680+ / 550+; PayNet 650+ / 640+ / 600+; comparable credit > 10 / > 7 / > 3 yrs; min tradelines 8 / 7 / 5; credit depth 5 / 5 / 3 yrs; revolving available > 60% / > 50% / > 40% unless balance < $10K; homeowner rules (deed or mortgage/HELOC ≥ financed amount, on-time 24 mo, 12 mo for A-3; non-homeowner comp debt ≥ 75% / 50% / 50%); child support none/none/>1 yr; tax liens none open (A-3: none open > $5K and < 5 yrs).
- STANDARD PRICE CARD B (TIB < 2 years): B-1 / B-2 — EFA/lease 12.50% / 16.00%; loan 13.75% / 17.60%; LTV titled 130/120%, non-titled 150/140%; max app-only $200K; DP 5% / 10%; industry experience 3+ yrs; FICO 720+ / 640+; PayNet 650+ / 620+; comp credit > 10 / > 5 yrs; tradelines 8 / 6; credit depth 5 yrs; revolving > 60% / > 40%.
- SPECIAL PRICE CARD A/B (higher risk / lower performance equipment — sleepers, printing, logging etc.): A-1/A-2/A-3 EFA 16.50% / 21.00% / 24.00% (sleepers 18.15/23.10/26.40; trailers 15.68/19.95/22.80); B-1/B-2 EFA 21.00% / 26.00%; non-homeowners: home ownership required (A-1) or comp debt ≥ 70%; no cash-out on sleepers, printing, logging.
- CORP ONLY: Tier-1 $350K, TIB 5 yrs, PayNet 670, 5 corp-only tradelines, 15 employees min, hard assets only, EFA 10.00%; Tier-2 $250K, TIB 3 yrs, PayNet 650, 3 corp-only tradelines, EFA 12.50%; disqualified for liens/judgments/BK.
- COMMISSION SCHEDULE (of financed amount): Standard Tier 1 11% (<$150K) / 9% / 7% / 5% / 4% (to $2.5MM); Tier 2 10/8/6/4/4; Tier 3 9/7/5/4/4; Special Tier 1 8/7/6/4/4; Tier 2 7/6/5/4/4; Tier 3 6/5/4/0/0. "Let's Make a Deal": buy rate −50 bps per −100 bps broker fee, −50 bps per +500 bps down payment, −25 bps per −6 months term; max reduction 200 bps; buy rate never below 8.5%.
- EQUIPMENT GUIDELINES (age / mileage or hours): Sleepers 4 yrs (2022+) / 350,000 mi (up to 6 yrs & 700k with 3-yr TMW); Day cab & auto carriers 8 yrs / 350k; Class 8 other 8 yrs / 350k; non-Class-8 trucks 8 yrs / 500k; medium duty 8 yrs / 300k; small dump 8 yrs / 350k; large dump 10 yrs / 350k; livery sedan/SUV 5 yrs / 75k, minibus 6–8 yrs, coach 12 yrs / 500k; reefers 6 yrs / 15k hrs; other trailers 8 yrs (ineligible if hauled by pickup); logging light 10 yrs, heavy 15 yrs; construction light 10 yrs, heavy 15 yrs, ag tractors 20 yrs; cranes/crushers/ADT 20 yrs; medical NEW ONLY; printing 5 yrs (10 if digital/inkjet); machine tools 10 yrs; all other 5 yrs case-by-case. Ineligible: Coronado/Columbia post-2010 (glider kits), International ProStar/MaxxForce sleepers, 2013–2016 ProStar MaxxForce daycabs, Cascadia/ProStar dump conversions.
- UNACCEPTED ASSET CATEGORIES: adult entertainment; gambling equipment; cannabis-related; ammunition/weapons; airplanes; rail car; marine vessels; trains; glider kits; small gooseneck trailers; used medical; pork production; refurbished/reconditioned/rebuilt; assets used outside USA; car carrier truck and trailer.
- Products: EFA, loan (EFA + 1.1 bps; early buyout after 18 on-time payments), TRAC, $1/$101 buyout, true FMV, reserve lease; Cash Out program (loan against paid-off equipment; not on Special Card assets; inspection required).
- Perks: startups 640+ FICO & 3 yrs industry experience; owner-operators and sole props; additional collateral; placeholder approvals; private party sales.
- Contacts: apps@nmef.com (new deals), fasttresubmits@nmef.com, apprfi@nmef.com, fastdocs@nmef.com; main 203-354-6000; broker portal broker.nmef.com; HQ 601 Merritt 7 Suite 5, Norwalk, CT 06851; titling/lienholder North Mill Credit Trust, 9 Executive Circle Suite 230, Irvine, CA 92614.

SCHEMA MAPPING: equipment, $15,000–$300,000, minCreditScore 550, TIB 0, all 50 states, and apps@nmef.com. The startup 640+ FICO and 3-year industry-experience requirements remain in source statements pending structural matcher support.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "CapTech Financial",
    programTypes: Object.freeze(["equipment"]),
    minAmount: 250_000,
    maxAmount: 25_000_000,
    minCreditScore: null,
    minTimeInBusinessMonths: null,
    acceptedStates: ALL_US_STATES,
    contactEmail: null,
    notes: `SOURCE STATEMENTS (verbatim):
- Largest independent mid-to-large-ticket direct lender in the US. Deal size $250K–$25MM+; term 24–60 months; operating and capital leases; no blanket liens; no financial covenants; equipment, software, and soft-cost financing; international funding for US-based companies.
- Credit requirements: audited or reviewed financial statements (or internals with tax returns); positive cash flow; profitable in two of the last three years; if not profitable, positive EBITDA in most recent YE and YTD, or a compelling turnaround story.
- Industry and collateral targets: technology equipment; software and software development; FF&E; tenant improvements/remodels; logistics/warehouse management; retail/hospitality; medical devices/services; manufacturing all categories; food production/packaging; energy production all types; construction; agriculture; automation; aviation.
- Deal package: purpose (new/used equipment, sale-leaseback, or refinancing); project description; last two YE financial statements; current YTD and prior YTD comparable; funding and installation timeframe.
- Credit approval in 2–10 business days after formal submission; uncapped referral fee on all funded transactions.
- Address: 1495 South Dixie Dr., St. George, UT 84770.

SCHEMA MAPPING: equipment, $250,000–$25,000,000, minCreditScore null, minTimeInBusinessMonths null, all 50 states, and contactEmail null. Financial-statement requirements remain in source statements pending structural matcher support.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
  Object.freeze({
    name: "Ophelia Capital Group",
    programTypes: Object.freeze(["working_capital", "MCA"]),
    minAmount: 250_000,
    maxAmount: null,
    minCreditScore: null,
    minTimeInBusinessMonths: 24,
    acceptedStates: ALL_US_STATES,
    contactEmail: "subs@opheliacapitalgrp.com",
    notes: `SOURCE STATEMENTS (verbatim):
- Direct funding source for MCAs. Funds ALL industries except car dealerships, trucking, and law firms — unless they are a high-volume-in-deposits company ($1MM+).
- Time in business: 2 years minimum. FICO: any (rarely pull credit). Ownership for funding: 51%. Minimum monthly gross deposits: $1,000,000+. Negative days/NSF: 2–5 days (with overdraft protection only). Minimum funding amount: $250,000. Terms: 60–200 days. Repayment: daily, biweekly, weekly.
- Same-day commissions. Contact Avi Nisanov, President; +1 (917) 653-8331; subs@opheliacapitalgrp.com; New York.

SCHEMA MAPPING: working_capital + MCA, min $250,000, maxAmount null, minCreditScore null, TIB 24 months, all 50 states, and subs@opheliacapitalgrp.com. The $1,000,000 monthly-revenue rule and restricted-industry exception remain in source statements pending structural matcher support.`,
    isActive: true,
    acceptedIndustries: Object.freeze([]),
  }),
] as const);

export type NewLenderSeed = (typeof NEW_LENDER_SEEDS)[number];

export function newLenderSeedToInsertValues(seed: NewLenderSeed) {
  return {
    name: seed.name,
    programTypes: [...seed.programTypes],
    minAmount: seed.minAmount,
    maxAmount: seed.maxAmount,
    minCreditScore: seed.minCreditScore,
    acceptedIndustries: [...seed.acceptedIndustries],
    minTimeInBusinessMonths: seed.minTimeInBusinessMonths,
    acceptedStates: [...seed.acceptedStates],
    ...("maxExistingPositions" in seed ? { maxExistingPositions: seed.maxExistingPositions } : {}),
    ...("contactName" in seed ? { contactName: seed.contactName } : {}),
    contactEmail: "contactEmail" in seed ? seed.contactEmail : null,
    notes: seed.notes,
    isActive: seed.isActive,
  };
}

export interface NewLenderSeedPlan {
  toCreate: readonly NewLenderSeed[];
  unchangedNames: readonly string[];
}

/**
 * Pure exact-name planner used by the transactional endpoint. It deliberately
 * does not compare or mutate records: an existing matching name is preserved.
 */
export function planNewLenderSeeds(
  existingNames: readonly string[],
): NewLenderSeedPlan {
  const existing = new Set(existingNames);
  return {
    toCreate: NEW_LENDER_SEEDS.filter((seed) => !existing.has(seed.name)),
    unchangedNames: NEW_LENDER_SEEDS
      .filter((seed) => existing.has(seed.name))
      .map((seed) => seed.name),
  };
}