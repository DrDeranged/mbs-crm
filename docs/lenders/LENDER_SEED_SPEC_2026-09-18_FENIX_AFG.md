LENDER SEED SPEC — ADDENDUM 4 — extracted 2026-09-18
Sources: Drive "MBS LENDERS/FENIX UW GUIDELINES 2026.pdf" (updated 04/01/2026); Gmail thread "Trucking Requirements", Atalie Curtis (AFG) → Nate Ford, 2026-09-18.
Same rules as prior specs: schema fields mapped, everything else verbatim in notes, "not stated" → null.

=====================================================================
NEW LENDER
=====================================================================

--- 17. name: "Fenix Capital Funding" ---
programTypes: ["working_capital", "MCA"]
minAmount: null (not stated) | maxAmount: 250000 (MCA) — reverse consolidations to 375000; record 250000 and note the reverse cap
minCreditScore: 500 ("minimum 500 preferred, exceptions made for files with MCA history")
minTimeInBusinessMonths: 12 ("based on months in which revenue was generated")
minMonthlyRevenue: 20000 ("at least $20k monthly excluding transfers, returns and international wires")
acceptedStates: all US EXCEPT Puerto Rico, Hawaii, California, Alaska
contactEmail: "iso@fenixcapitalfunding.com"
notes (verbatim source statements, Underwriting Guidelines updated 04/01/2026):
- THE BOX: 1st–5th positions and reverse consolidations; max funding $250k for MCAs and $375k for reverses; max term 15 months (60 weeks); daily, weekly and bi-weekly payments; straight buyouts up to $100k; EPAs included in every contract; sweet spot 2nd–3rd position behind reputable A-paper funders; renewals as early as 25% paid in, plus add-ons; max holdback 30% total.
- BASIC REQUIREMENTS: TIB minimum 1 year; credit score minimum 500 preferred (exceptions with MCA history); revenue ≥ $20k monthly excluding transfers, returns and international wires; negative days up to 5 per month; minimum 4 deposits per month; ownership minimum 67%; no open bankruptcies or defaults.
- BACKGROUND: no previous defaults unless satisfied timely with re-established payment history. Bankruptcies — will not fund where (a) a pattern of frequent bankruptcies, (b) Chapter 7/11 discharged less than 3 years or dismissed within a year, or (c) Chapter 13 discharged less than 1.5 years or dismissed within a year. Tax liens case-by-case, but automatic decline if (a) liens within a year or (b) more than $50k in liens without a payment plan. Criminal background — financial crimes, fraud, OFAC issues or any violent criminal history is an automatic decline. Civil judgments case-by-case.
- SUBMISSION DOCS: signed and dated application for each owner (67% of ownership required); 3 months business bank statements (4 months for NY); current balances for active positions if applying for a reverse/buyout. FOR CONTRACTS: voided check for the primary business account; driver's licence and a separate email for each owner; balance confirmations for current positions on buyouts/reverses. FOR FUNDING: proof of ownership (SOS, tax returns, EIN letter, purchase agreement), future-receivables confirmation (detailed AR, invoices, CC processing statements) unless visible, proof of citizenship (US passport, green card, EAD), bank verification (manual or Decision Logic, confirmed with UW), Persona ID verification link completed by the merchant, payback months and Tax Guard for files over $150k, additional docs case by case.
- EARLY PREPAYMENT DISCOUNTS: every contract includes a Discount Addendum. Term longer than 8 months (160 days / 32 weeks): days 1–30 = 20 discount points, 31–60 = 16, 61–90 = 12, 91–120 = 8. Term 8 months or shorter: 1–30 = 16, 31–60 = 12, 61–90 = 8. "Your commission on the deal doesn't change. Instead, points are taken off the factor."
- AGGRESSIVE EPA (profit-sharing model): ISO receives 20% of the factor points upfront and the remaining commission after 90 days. Example: EPAs of 1.10 (30 days), 1.13 (60), 1.16 (90) → 2 points upfront (20% of 0.10), the rest after 90 days.
- EXCLUSIVITY: given to the submitting ISO when the contract is signed, lasting 3 business days; duplicate ISO submissions auto-declined during that window; if not funded in 3 business days exclusivity ends; where multiple ISOs submit the same business they receive the same offer/revisions and the ISO who gets the contract signed first holds exclusivity; rate/fee reductions come out of the ISO's commission when there is competition; exclusivity ends after payoff.
- PRICING: average term 36–40 weeks, max 60 weeks; processing fee 5% on MCA files, 6% on consolidation files; all offers sent with 12 points commission built in unless competing offers have been downsold; restricted states PR, HI, CA and AK; weekly/bi-weekly payments case by case.
- AUTO DECLINES: currently in a consolidation with another funder; currently on reduced payments with another funder or bouncing payments to current funders; past-due child support on the personal credit report; payments to MCA debt restructuring/relief companies; multiple fundings within the last 30 days.
- RESTRICTED INDUSTRIES: adult entertainment; gaming/gambling; non-profit; law firms; auto sales; bail bonds; check cashing; fix and flip; TRUCKING; auctions or pawn shops; credit repair; gas stations; payroll or payment processing; staffing; property management (unless properties are owned by the merchant); money transfer services/financial institutions; securities and commodities dealers; financial brokers; oil field services; travel agencies.
- ADDRESS: Fenix Capital Funding, LLC, 9265 4th Ave Fl 2, Brooklyn, NY 11209. Main line (877) 563-4226. ISO email iso@fenixcapitalfunding.com. Introduced to MBS by Klaudia (partner inquiry forwarded by Nate Ford 2026-09-17).
SCHEMA MAPPING: working_capital + MCA; max 250000 (reverse 375000 in notes); minCreditScore 500; TIB 12; minMonthlyRevenue 20000; excluded states PR/HI/CA/AK; prohibited industries = the restricted list above (note TRUCKING is prohibited — Fenix must never match a trucking lead).
isActive: true

=====================================================================
UPDATE TO AN EXISTING LENDER
=====================================================================

--- "Alliance Funding Group (AFG)" — trucking criteria, direct from AFG 2026-09-18 ---
Source: Atalie Curtis, Strategic Partnership Coordinator, Alliance Funding Group, email to Nate Ford 2026-09-18.
Append to notes with marker "2026-09-18 AFG trucking criteria (direct from partner)":
- TRUCKING / TRANSPORTATION (OTR): 5 years time in business; minimum of 5 trucks currently in fleet; 680+ FICO; homeownership; satisfactory PayNet report.
- "That's just for OTR and trucking/transportation companies. We do vocational vehicles without guidelines but no tow trucks!" — i.e. vocational vehicles are financed WITHOUT the trucking criteria above; TOW TRUCKS are excluded entirely.
- Contact correction: Atalie's email on this thread is acurtis@afg.com (her signature block still shows adaniel@afg.com); phone (714) 221-1019, mobile (661) 487-5305; address 18231 Irvine Blvd, Tustin, CA 92780.
MATCHER: AFG's trucking gate becomes TIB ≥ 60 months AND trucksInFleet ≥ 5 AND FICO ≥ 680 AND homeownership, applied ONLY when the lead's equipment/industry is OTR trucking/transportation; vocational vehicles bypass the gate; tow trucks are excluded from AFG entirely.
