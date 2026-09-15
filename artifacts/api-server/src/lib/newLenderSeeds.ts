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