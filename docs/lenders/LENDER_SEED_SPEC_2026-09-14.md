LENDER SEED SPEC — from "lenderdocsupdated (2).zip" + Luminar packet — extracted 2026-09-14
Field shape matches artifacts/api-server/src/lib/newLenderSeeds.ts. Values not supported by the schema go in notes verbatim. Nothing below is inferred; "not stated" means the packet is silent.

=====================================================================
NEW LENDERS (add to NEW_LENDER_SEEDS, idempotent by exact name)
=====================================================================

--- 1. name: "Navitas Credit Corp" ---
programTypes: ["equipment"]
minAmount: 10000 | maxAmount: 350000 (app-only; commercial program $250k–$500k with financials; $500k–$2.5MM+ call)
minCreditScore: 660 (Bronze tier floor; Silver 675, Gold 700, Platinum 725)
minTimeInBusinessMonths: 24 (Bronze/Silver at $10k–$75k; higher tiers/amounts need 36–60; Start-Up program 0–24 mo see notes)
acceptedStates: all 50 + DC (not stated otherwise)
contactEmail: "myapplications@navitascredit.com"
notes (verbatim source statements):
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
isActive: true

--- 2. name: "Keystone Equipment Finance Corp (KEF)" ---
programTypes: ["equipment"]
minAmount: 10000 | maxAmount: 150000 (marketing deck says to $250k; credit guidelines say max $150k — use 150000, note the discrepancy)
minCreditScore: 550
minTimeInBusinessMonths: 0 (startups accepted with ≥1 year industry experience)
acceptedStates: all 50 (not stated otherwise)
contactEmail: "jgothers@keystoneefc.com"
notes (verbatim source statements):
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
isActive: true

--- 3. name: "Channel Partners Capital" ---
programTypes: ["working_capital", "equipment"]
minAmount: 10000 (WC) / 15000 (EF) — use 10000, note EF floor
maxAmount: 400000 (WC); EF tier exposure to $250k–$300k
minCreditScore: 600
minTimeInBusinessMonths: 12 (WC); EF tiers 24–84
acceptedStates: all 50 (not stated otherwise)
contactEmail: "newdeals@channelpartnersllc.com"
notes (verbatim source statements, guidelines dated May/June 2026):
WORKING CAPITAL: $10k–$400k, terms 6–24 months; minimum annual revenue $175,000; minimum TIB 1 year; minimum FICO 600; BK discharge 2 years with re-established credit; tax liens >$50k must be paid or on payment plan; origination fee 2.5%; commission max 12 pts (Select 8 / Choice 5 / renewals 6 / fundings >$150k 8). Submission: application + most recent 3 months bank statements. Funding: valid DL/passport, voided business check, verification of material ownership; site inspection may be required. Can pay off competing WC loans up to $125k balance if customer retains ≥50% of proceeds.
EQUIPMENT FINANCE tiers: Tier 1–3 $250k ($300k hard asset), 7+ yrs TIB, 720+ FICO, comp credit $150k+; Tier 4 $150k, 5+ yrs, 700+, $75k+ comp; Tier 5 $100k, 4+ yrs, 660+, $50k+ comp; Tier 6 $75k, 3+ yrs, 620+; Tier 7 $50k, 2+ yrs, 600+. Max term 72 new / 60 used. Age limits: hard asset 20 yrs, titled 15 yrs, other 7 yrs. Min $15k financed; no PPS/fixtures/high-risk assets on tiers 5–7.
TRANSPORTATION: long haul — fleet 10+, 6+ yrs TIB; local — fleet 2+, 4+ yrs TIB; preferred FICO 700+; comp credit 50% of request; max $150k; liability insurance on titled vehicles.
EF fees: origination $199 (<$50k) / $299 (>$50k); prefunding $100; wire $35; site inspection $195; lien search $50/entity; titling $300/asset. EF commission: <$75k 15 pts; $75k–$100k 10; >$100k 8.
Restricted industries: adult, credit service/collection/repo, day trading, financial services, firearms, gambling, government, insurance, legal services, marijuana/CBD, marinas**, mining, money service, mobile home dealers, MLM, non-profit**, oil, political orgs, precious metals, religious**, tanning**, tattoo/massage, tax prep**, vape (** = exception basis). Restricted equipment: non-essential, aircraft, aesthetic lasers, ATMs*, boats, copiers/printers, gaming, invasive medical, leasehold improvements*, agriculture equipment.
Address: 10900 Wayzata Blvd Ste 300, Minnetonka, MN 55305; (763) 746-7760; submissions via Partner Portal.
isActive: true

--- 4. name: "TimePayment Corp" ---
programTypes: ["equipment"]
minAmount: 500 | maxAmount: 1500000
minCreditScore: null (proprietary scoring, "challenged to well qualified", startups considered)
minTimeInBusinessMonths: 0 (startups; 'O' score 2+ yrs; A 3+, AA 5+, AAA 10+)
acceptedStates: all 50 ($1 buyout only in AL AZ CO DE FL HI IN LA ME MD MA MO NC OH OK PA SC SD TX UT WI WY; KS and NY guarantors FMV-only)
contactEmail: "brokerdesk@timepayment.com"
notes (verbatim source statements):
- Boston FinTech, 30+ yrs, 100k+ active accounts; leases $500–$1.5MM+; terms 12–60 months; instant credit decisions up to $25k; personal-guarantee and corp-only accepted; commercial only.
- Products: FMV lease, Lease with Purchase Option (3 payments buyout), $1 Buyout (AAA/AA/A credits, listed states only).
- Credit scores: AAA 10+ yrs TIB and $10k min equipment cost; AA 5+ yrs; A 3+ yrs; 24-mo AA/A require $5k min equipment cost; 'O' score 2+ yrs and funded to $150k+.
- Build commission into the requested amount (Equipment + Commission = Requested Funding). Min processing fee $125. Site inspections on leases > $50k. Direct debit required on leases ≥ $10k. Startups: 10% security deposit may be required.
- Excluded industries: ATM and bankcard, cannabis, computers and 100% software, copiers, security and monitoring, water quality products.
- Portal: InfoHub (quotes, eSign, tracking). 866-994-7260. The seeded deal "TP K1 Speed" was funded through TimePayment.
isActive: true

--- 5. name: "PEAC Solutions" ---
programTypes: ["equipment", "working_capital"]
minAmount: 10000 | maxAmount: 250000 (app-only; $150k standard / $250k "A" credits)
minCreditScore: 640 (Vantage; 620 with Structured Finance Program in some states)
minTimeInBusinessMonths: 24 (under $30k; scales to 120 mo at $150k–$250k — see grid)
acceptedStates: all 50 (SFP not available in all states due to usury laws)
contactEmail: "ezucchi@PEACsolutions.com"
notes (verbatim source statements, Feb 2025 manual):
- App-only grid (with PG): <$30k: TIB 2y, Vantage 640, >25% revolving available, Paydex 65; $30k–$50k: 3–4y, 660, >25%; $50k–$75k: 5y, 680, >50% revolving, 10 employees, comp debt; $75k–$100k: 7y, 680; $100k–$150k: 8y, 680; $150k–$250k: 10y, 700, Paydex 70. Comp debt = commercial tradelines ≥50% of request, required at $50k+ or corp-only.
- Corp-only grid: <$30k 3–4y TIB, CCS 425, SBRI 820; up to $150k–$250k 10y, 500, 850, Paydex 70, 30 employees.
- Personal credit: 5+ yrs from BK/foreclosure discharge; at least 3 tradelines; fewer than 10 inquiries.
- Structured Finance Program: 1–2 yrs TIB → $20k max, 36-mo max term, 620 Vantage, 2 advance payments, 3 months banks, ACH; 2nd Chance (2+ yrs TIB) $10k–$50k, 36–60 mo; 16% rate.
- Points: $10k–$50k 15; $50k–$75k 12; $75k–$100k 10; $100k+ 8. Doc fee $125 (≤$50k) / $150 / $250 / $350 titled; prefund $100; wire $40, ACH free.
- Working capital program: exists per cover (Elena Zucchi, 856-505-4402) — WC criteria not in the extracted pages; mark WC "criteria pending" in notes and do not set WC-specific minimums.
- Approved asset types: broad (air compressors through vending); restricted list per manual.
isActive: true

--- 6. name: "Luminar Capital" --- (from the separate Luminar packet; record already given in chat — include in the same seed set)

=====================================================================
UPDATES TO EXISTING LENDERS (write as targeted updates keyed by exact existing name — do NOT recreate; keep existing contact rows)
=====================================================================

--- "Alliance Funding Group (AFG)" — current CRM shows WC+equipment, $10k–$500k, FICO ≥600, TIB ≥48 mo ---
WORKING CAPITAL (Premium WC, app-only to $300k; up to $3MM with financials): terms 6–15 mo, weekly payback, 2% origination; grades Platinum 720+ FICO/670 PayNet (1.09–1.14), Gold 675+/660+ (1.09–1.18), Silver 650+/650+ (1.15–1.21, max 12 mo); MINIMUM 4 YEARS TIB; 3 months banks showing $20k+ avg monthly deposits; no negative ending-balance days; no prior bankruptcies; no concurrent WC contracts; open positions case by case, must net ≥50% if paying off one loan; principal-only payoff after 14 weeks. Commission 8 pts to $150k, 6 pts $151k+ (Silver up to 20). Restricted (WC): cannabis, law offices, adult, vending, gaming, staffing, non-franchise used car dealers, MSBs, real estate agents/brokers, vape, collections, pawn; transportation cautionary — 5 yrs TIB, 5 trucks, homeownership; online retailers, import/export, accounting, financial services also restricted per WC sheet.
EQUIPMENT (app-only $50k–$500k, A–C credits): minimum FICO 600, minimum PayNet Master 620, rates 8.25%–23%, 20-pt commission cap, EFA/$1-out/TRL/FMV. Restricted (EF): cannabis, law offices, adult, tow trucks for towing businesses, med lasers/med spa, vending, gaming, staffing, non-franchise used car dealers, MSBs, real estate agents, vape, collections, pawn, motorcoaches, used high-tech, Penske/Ryder dealers. Cautionary: transportation (5 yrs TIB, 5 trucks, homeownership), oil production, brewery/distillation, food trucks, non-essential equipment, passenger cars, firearms.
Middle market $500k–$50MM+ with full financials.
Contacts: Tyson Garrett VP (714) 453-3687 TGarrett@afg.com; Atalie Daniel (714) 221-1019 adaniel@afg.com (already on file); Ashley Bradburn, Katie Bates. Payoffs: PayoffRequest@afg.com.
→ Schema: set WC minTimeInBusinessMonths 48 and WC minCreditScore 650 (Silver floor) / EF minCreditScore 600 if the schema supports per-program values; otherwise keep 600/48 and put the split in notes. maxAmount stays 500000 (EF app-only); WC app-only 300000 in notes.

--- "AMUR Equipment Finance" — current CRM shows equipment, $10k–$750k, FICO ≥620, TIB ≥24 mo ---
Broker program tiers: A — app-only to $350k, 700+ FICO, 660+ PayNet, 66% comparable debt, 5+ yrs TIB, no suits/liens/judgments/BK, from 8.25% buy rate, zero down; B — to $250k, 660+ FICO, 640+ PayNet, 50% comp debt, 2+ yrs TIB, from 10.00%; C — to $125k, 620+ FICO, 620+ PayNet, 50% comp debt, 2+ yrs TIB, from 15.75%; NEW BUSINESS (<2 yrs) — max $60k financed, 700+ FICO AND homeownership for all guarantors, 50% comp debt, 20% down or security deposit, ACH mandatory, from 20% with bank statements. All transactions: minimum 7 years in credit bureau and minimum 7 tradelines. Commission: up to 15 pts under $150k, 8 pts $150k+. Specialty Vehicle and Construction Vendor programs exist (tables are images — not extractable; note as "see program sheets"). Submissions: AEFCreditSubmissions@GoAmur.com; 308.398.4140 / 800.994.0016; Grand Island, NE.
→ Schema: minCreditScore stays 620; minTimeInBusinessMonths stays 24 (0 for New Business program in notes); maxAmount 350000 app-only (current 750000 came from an older packet — confirm with Nate before lowering; leave 750000 and note "app-only cap $350k" unless he confirms).

--- "Y.E.S. Leasing" — current CRM shows equipment, $10k–$300k, no FICO ---
2026 guidelines: NO personal credit requirement (funds sub-500 FICO); $10k–$300k; deposit/down 10–20% (general), 25% all dump trucks, 35–50% of cost for yellow iron $10k–$150k; revenue-to-equipment-cost ratio 30% if under $100k, 50% if $100k+ (qualifies 95%+ when met); non-citizens OK; package = signed app within 30 days + 3 months business banks + invoice. Income Generating General Equipment program: $10k–$150k total, medical $75k max, 24–48 mo terms, no private party sales. Dump Truck program: Class 8 $15k min, $85k new / $55k used, <750k mi, ≤10 yrs; Class 6/7 <200k mi, $50k max. Directional drill package max $300k. Higher-tier program: 650+ FICO, 2+ yrs TIB, $15k–$300k, 24–48 mo, ≥$55k monthly revenue. Contact Bobby Cowan (678) 478-0152, bobby@yesleasing.com; submit apps@yesleasing.com cc bobby@.
→ Schema: no changes to amounts; minCreditScore null (confirm current); add the ratio rule and down-payment schedule to notes.

---- "Financial Pacific Leasing (FINPAC)" — no documents in the zip. Unchanged.