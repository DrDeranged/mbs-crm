LENDER SEED SPEC — ADDENDUM 2 — from MBS_Lender_Files.zip + NMEF Mini Handbook (Aug 2026) + TimePayment Referral Guide 2026 — extracted 2026-09-15
Same rules as the 2026-09-14 spec: schema fields mapped, everything else verbatim in notes, "not stated" → null. Append this file to docs/lenders/ as LENDER_SEED_SPEC_2026-09-15_ADDENDUM.md.

=====================================================================
NEW LENDERS (add to NEW_LENDER_SEEDS, idempotent by exact name)
=====================================================================

--- 7. name: "North Mill Equipment Finance (NMEF)" ---
programTypes: ["equipment"]
minAmount: 15000 | maxAmount: 300000 (app-only; $200k app-only for startups <2 yrs TIB; $300k+ requires full financials)
minCreditScore: 550 (640+ if TIB < 2 years)
minTimeInBusinessMonths: 0 (startups accepted with 640+ FICO and 3 yrs industry experience)
acceptedStates: all 50 (not stated otherwise; assets must be housed/used inside the USA)
contactEmail: "apps@nmef.com"
notes (verbatim source statements, Mini Handbook August 2026, pricing effective May 1, 2026):
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
isActive: true

--- 8. name: "CapTech Financial" ---
programTypes: ["equipment"]
minAmount: 250000 | maxAmount: 25000000
minCreditScore: null (financial-statement underwriting; not stated)
minTimeInBusinessMonths: null (not stated; requires 2 years of year-end financials)
acceptedStates: all 50 + international funding for US-based companies
contactEmail: null (not stated — phone 435.268.4700, captechfinancial.com)
notes (verbatim source statements, Transaction Guidelines April 2026):
- Largest independent mid-to-large-ticket direct lender in the US. Deal size $250K–$25MM+; term 24–60 months; operating and capital leases; no blanket liens; no financial covenants; equipment, software, and soft-cost financing; international funding for US-based companies.
- Credit requirements: audited or reviewed financial statements (or internals with tax returns); positive cash flow; profitable in two of the last three years; if not profitable, positive EBITDA in most recent YE and YTD, or a compelling turnaround story.
- Industry and collateral targets: technology equipment; software and software development; FF&E; tenant improvements/remodels; logistics/warehouse management; retail/hospitality; medical devices/services; manufacturing all categories; food production/packaging; energy production all types; construction; agriculture; automation; aviation.
- Deal package: purpose (new/used equipment, sale-leaseback, or refinancing); project description; last two YE financial statements; current YTD and prior YTD comparable; funding and installation timeframe.
- Credit approval in 2–10 business days after formal submission; uncapped referral fee on all funded transactions.
- Address: 1495 South Dixie Dr., St. George, UT 84770.
SCHEMA MAPPING: equipment program, $250,000–$25,000,000; everything else in notes. This lender is financial-statement based and not app-only; the matcher should treat it as a candidate only for requestedAmount ≥ 250000.
isActive: true

--- 9. name: "Ophelia Capital Group" ---
programTypes: ["working_capital", "MCA"]
minAmount: 250000 | maxAmount: null (not stated)
minCreditScore: null ("Any — we rarely pull credit")
minTimeInBusinessMonths: 24
acceptedStates: all 50 (not stated otherwise)
contactEmail: "subs@opheliacapitalgrp.com"
notes (verbatim source statements, Guidelines April 2026 + one-pager):
- Direct funding source for MCAs. Funds ALL industries except car dealerships, trucking, and law firms — unless they are a high-volume-in-deposits company ($1MM+).
- Time in business: 2 years minimum. FICO: any (rarely pull credit). Ownership for funding: 51%. Minimum monthly gross deposits: $1,000,000+. Negative days/NSF: 2–5 days (with overdraft protection only). Minimum funding amount: $250,000. Terms: 60–200 days. Repayment: daily, biweekly, weekly.
- Same-day commissions. Contact Avi Nisanov, President; +1 (917) 653-8331; subs@opheliacapitalgrp.com; New York.
SCHEMA MAPPING: WC/MCA, min $250,000, TIB 24 months, no credit minimum. Matcher: candidate only when monthly revenue ≥ 1,000,000 — if the matcher lacks a monthly-revenue gate, state so in the report; do not approximate with amount.
isActive: true

--- NCMIC Professional Solutions --- DO NOT SEED. Only broker agreement, application, W-9, and ACH form supplied — no underwriting criteria. Add to the "awaiting guidelines" list with FINPAC.

=====================================================================
UPDATES TO EXISTING LENDERS (append to EXISTING_LENDER_UPDATES with marker "2026-09-15 packet update"; append notes, never delete)
=====================================================================

--- "Dexly Finance" — July 2026 ISO Guidelines SUPERSEDE the March 2026 document the current seed was built from ---
Schema changes: none to amounts ($75,000–$5,000,000 unchanged), TIB 12 unchanged. Notes to append (verbatim, July 2026):
- Paper types: B to D (was A–D). Positions: NO LIMIT (was 1–5). Funding terms: 6 weeks to 32 weeks. Primary market: all 50 states (Texas first position only), Puerto Rico & Canada. Revenue: minimum $200,000 monthly. Repayment: daily or weekly. Origination fees: 1% to 10%.
- RESTRICTED INDUSTRIES (minimum $1,000,000 monthly revenue): auto dealership (new); construction — general/home remodeling/subcontractor; consulting; energy/oil & gas; hospitality — vacation rentals; IT — software development; law firm; real estate — development/property management; services — staffing; transportation — passenger/trucking; wholesale — food distribution/goods.
- PROHIBITED INDUSTRIES: auto dealership (used); bail bonds; cannabis — dispensary/grower; cash exchange (check cashing/ATM/pawn); collection agency/credit repair; financial services; logistics/import & export; freight brokers; real estate — brokerage; religious services; services — travel agency.
- ISO commission by factor rate: 1.30 = buy rate; 1.31–1.35 = 0.8%–4% of funded amount; 1.36–1.40 = 4.8%–8%; 1.41–1.45 = 8.4%–10%; 1.46–1.50 = 10.4%–12%.
- Submissions to underwriting@dexlyfinance.com cc Relations Manager; all communication in the original thread. Stipulations: application, 3 recent bank statements, accounts receivable, tax return, merchant DL/VC, credit card statement.
- (September 2026 bonus structure PNG is a promotional commission bonus, not criteria — not recorded.)

--- "TimePayment Corp" — 2026 Referral Guide adds the credit-tier table ---
Schema changes: maxAmount 1,500,000 → 150,000 (the credit chart caps every tier at $150K total funding; the $1.5MM figure is marketing copy). minAmount stays 500.
Notes to append (verbatim, Referral Guide 2026):
- CREDIT TIERS (min–max total funding / yrs in business / FICO / startups? / challenged credit?): AAA $10K–$150K / 10+ / 750+ / no / no; AA $500–$150K / 5+ / 750+ / yes / no; A $500–$150K / 3+ / 725+ / yes / no; O $500–$150K / 2 / 725+ / yes / no; P $500–$50K / 5+ / 650+ / yes / no (personal credit thinner profile); P (start-up) $500–$50K / <2 / 750+ / yes / yes; S $500–$20K / <2 / 675+ / yes / yes; T $500–$20K / <2 / 650+ / yes / yes; Q $500–$10K / <2 / 625+ / yes / yes; U $500–$6K / <2 / 550–625 / yes / yes (bankruptcy history if discharged or dismissed; security deposit may be required). Mortgage or $50K+ loan history required for AAA/AA/A/O/P.
- Up to 15 points per deal on vendor invoice total. Min security deposit 10% for start-ups when approval ≥ $15,000. Personal guarantor required when TIB < 3 years; verifiable owner must be first PG; non-owner relative co-signer considered with 2 paystubs. Soft credit pull via Experian. Corp-only: requests < $10,000 with 3+ yrs TIB; over $10,000 requires 5+ yrs. Start-ups up to $50,000; more with a cross-corporate guaranty (mutual ownership required). Financials (2 yrs business tax returns + 3 months banks) required for CCG offers and requests ≥ $75,000. Site inspections on leases ≥ $50,000. Direct debit required ≥ $10,000.
- Restrictions: consumer, private party sales, sale leasebacks, working capital, permanent fixtures, ATM, POS/bankcard, cannabis, computers & 100% software, copiers, security & monitoring, water quality products. Up to 40% of invoice may be soft costs. Verbal verifications required in New York.
- $1 buyout states (2026): AL, AZ, CO, DE, HI, IN, LA, MD, ME, MO, NC, OH, OK, PA, SD, UT, WI, WY (TX, MA, SC dropped vs earlier guide).
- Contacts: Caitlin Keefe 855-259-1034 caitlin.keefe@timepayment.com; Ian Mayer 866-994-7162 ian.mayer@timepayment.com; brokerdesk@timepayment.com 866-994-7260.

--- "Keystone Equipment Finance Corp (KEF)" — September 2026 FAQ + Equipment Parameters ---
Schema changes: none.
Notes to append (verbatim, FAQ Sep 2026): contract is EFA; prepayment premium .00834 × principal × remaining months; payments due 5th and 20th, 6-day grace; GPS most of the time; comp credit not required but preferred; homeownership not required but preferred; CDL requirement if business < 2 years; hard credit pull; Experian and PayNet (if necessary); minimum TIB none but experience preferred; DEAL BREAKERS: under 500 scores, post-BK delinquency. Equipment Parameters 2025: startups (≤18 mo) sleepers/day cabs 2017+ ≤599k; non-startups 2015+ ≤650k; box/reefer startups 2017+ ≤220k, non-startups 2015+ ≤299k; sprinter 2017+/175k, 2015+/220k; dump 2005+ 599k/650k; flatbed cab&chassis 2017+/220k, 2015+/299k; flatbed pickup & service 2017+/199k, 2015+/250k; trailers dry van/reefer 2017+/2015+ (reefer <20k hrs); flatbed/dropdeck 10 yrs / 15 yrs.

---- Unchanged (Aug 2026 docs identical to the 2026-09-14 packet): AFG, AMUR, Navitas, Y.E.S., Channel, PEAC. FINPAC: still no documents.