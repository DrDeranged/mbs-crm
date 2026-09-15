ALTER TABLE "lenders"
  ADD COLUMN IF NOT EXISTS "restricted_industries" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "prohibited_industries" text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "min_monthly_revenue" integer,
  ADD COLUMN IF NOT EXISTS "restricted_industry_min_monthly_revenue" integer,
  ADD COLUMN IF NOT EXISTS "startup_min_credit_score" integer,
  ADD COLUMN IF NOT EXISTS "startup_max_time_in_business_months" integer,
  ADD COLUMN IF NOT EXISTS "startup_max_amount" integer,
  ADD COLUMN IF NOT EXISTS "min_industry_experience_months" integer,
  ADD COLUMN IF NOT EXISTS "requires_financial_statements" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "trucking_rules" jsonb,
  ADD COLUMN IF NOT EXISTS "industry_time_in_business_overrides" jsonb,
  ADD COLUMN IF NOT EXISTS "program_eligibility_rules" jsonb;

ALTER TABLE "applications"
  ADD COLUMN IF NOT EXISTS "has_financial_statements" boolean,
  ADD COLUMN IF NOT EXISTS "has_factoring" boolean,
  ADD COLUMN IF NOT EXISTS "industry_experience_months" integer;

ALTER TABLE "lenders"
  ALTER COLUMN "min_time_in_business_months" DROP NOT NULL;

-- Backfill all lender rules that can predate this migration. This is
-- intentionally independent of notes markers: packet-note updates may already
-- have been applied without these structured matcher fields.
UPDATE "lenders"
SET
  "restricted_industries" = '{}',
  "min_monthly_revenue" = NULL,
  "trucking_rules" = NULL,
  "program_eligibility_rules" = '[{"programType":"working_capital","minMonthlyRevenue":20000,"restrictedIndustries":["cannabis","law offices","adult","vending","gaming","staffing","non-franchise used car dealers","MSBs","real estate agents/brokers","vape","collections","pawn","transportation","online retailers","import/export","accounting","financial services"],"truckingRules":[{"industry":"any","minTrucks":5,"minTimeInBusinessMonths":60}]},{"programType":"equipment","restrictedIndustries":["cannabis","law offices","adult","tow trucks for towing businesses","med lasers/med spa","vending","gaming","staffing","non-franchise used car dealers","MSBs","real estate agents","vape","collections","pawn","motorcoaches","used high-tech","Penske/Ryder dealers"],"truckingRules":[{"industry":"any","minTrucks":5,"minTimeInBusinessMonths":60}]}]'::jsonb
WHERE "name" = 'Alliance Funding Group (AFG)';

UPDATE "lenders"
SET "restricted_industries" = ARRAY['auto dealership (new)','construction','consulting','energy/oil & gas','hospitality — vacation rentals','IT — software development','law firm','real estate — development/property management','services — staffing','transportation — passenger/trucking','wholesale — food distribution/goods'],
    "prohibited_industries" = ARRAY['auto dealership (used)','bail bonds','cannabis','cash exchange','collection agency/credit repair','financial services','logistics/import & export','freight brokers','real estate — brokerage','religious services','services — travel agency'],
    "min_monthly_revenue" = 200000,
    "restricted_industry_min_monthly_revenue" = 1000000
WHERE "name" = 'Dexly Finance';

UPDATE "lenders"
SET "prohibited_industries" = ARRAY['adult entertainment','agriculture','cannabis','consultants/financial advisors','forestry/lumber/logging','gaming/gambling','mining','oil & gas','real estate/mortgage','security/commodity brokers','spas/medi spas','tanning','trucking long-distance','vendor route operators'],
    "trucking_rules" = '[{"industry":"long_haul","prohibited":true}]'::jsonb
WHERE "name" = 'Navitas Credit Corp';

UPDATE "lenders"
SET "restricted_industries" = ARRAY['adult','credit service/collection/repo','day trading','financial services','firearms','gambling','government','insurance','legal services','marijuana/CBD','marinas','mining','money service','mobile home dealers','MLM','non-profit','oil','political orgs','precious metals','religious','tanning','tattoo/massage','tax prep','vape'],
    "min_monthly_revenue" = NULL,
    "trucking_rules" = NULL,
    "program_eligibility_rules" = '[{"programType":"working_capital","minMonthlyRevenue":14583},{"programType":"equipment","truckingRules":[{"industry":"any","minTrucks":2,"minTimeInBusinessMonths":48},{"industry":"long_haul","minTrucks":10,"minTimeInBusinessMonths":72},{"industry":"local","minTrucks":2,"minTimeInBusinessMonths":48}]}]'::jsonb
WHERE "name" = 'Channel Partners Capital';

UPDATE "lenders"
SET "restricted_industries" = ARRAY['consumer','private party sales','sale leasebacks','working capital','permanent fixtures','ATM','POS/bankcard','cannabis','computers and 100% software','copiers','security & monitoring','water quality products']
WHERE "name" = 'TimePayment Corp';

UPDATE "lenders"
SET "prohibited_industries" = ARRAY['adult entertainment','all-cash businesses','auction','bail bonds','check cashing and money wiring','commodity-based (precious metals)','cryptocurrencies','debt collection and bankruptcy lawyer','drug paraphernalia','helicopter tours','international businesses','lending or financing firm (equipment finance)','lottery and gambling','multi-level marketing','non-profit and religious','solar'],
    "min_monthly_revenue" = 10000,
    "trucking_rules" = '[{"industry":"any","minTimeInBusinessMonths":36,"requiresNoFactoring":true}]'::jsonb,
    "industry_time_in_business_overrides" = '[{"industry":"law offices","minTimeInBusinessMonths":60},{"industry":"construction/general contractor","minTimeInBusinessMonths":24}]'::jsonb
WHERE "name" = 'Luminar Capital';

UPDATE "lenders"
SET "startup_min_credit_score" = 640,
    "startup_max_time_in_business_months" = 24,
    "startup_max_amount" = 200000,
    "min_industry_experience_months" = 36
WHERE "name" = 'North Mill Equipment Finance (NMEF)';

UPDATE "lenders"
SET "requires_financial_statements" = true
WHERE "name" = 'CapTech Financial';

UPDATE "lenders"
SET "restricted_industries" = ARRAY['car dealerships','trucking','law firms'],
    "min_monthly_revenue" = 1000000,
    "restricted_industry_min_monthly_revenue" = 1000000
WHERE "name" = 'Ophelia Capital Group';