INSERT INTO email_templates (name, subject, body_html, program_type, sender_mode, is_active)
SELECT
  'Equipment Financing — Review Before You Buy',
  'Most equipment deals don''t die on price',
  '{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p><strong>Most equipment deals don''t die on price. They die because the financing gets reviewed too late.</strong></p>
<p>My Business Solutions can review equipment financing from <strong>$10,000 to $5,000,000</strong>. Depending on the request, review may be available with a short application, an equipment quote or invoice, and recent business bank statements.</p>
<p>Financing may cover trucks, trailers, machinery, technology, fixtures, and other business equipment. Eligible soft costs may also be included when supported by the transaction.</p>
<p>If preserving cash is the priority, we can also review working-capital options for inventory, payroll, operating expenses, or the costs that come before revenue—without using the equipment line.</p>
<p>What equipment are you considering, and what is the approximate purchase amount?</p>
<p>Best,<br><strong>Nate Ford</strong> | CEO<br>My Business Solutions<br>Call or text 602-245-5425<br><a href="mailto:nate@my-business-solutions.com">nate@my-business-solutions.com</a><br><a href="https://my-business-solutions.com">my-business-solutions.com</a></p>
<p style="font-size:12px;color:#64748b">Financing subject to credit approval and underwriting. Terms vary.</p>',
  'equipment',
  'default',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM email_templates WHERE name = 'Equipment Financing — Review Before You Buy'
);

INSERT INTO email_templates (name, subject, body_html, program_type, sender_mode, is_active)
SELECT
  'Working Capital — Preserve Your Bank Line',
  'Working capital for the costs before the revenue',
  '{{brand_email_header}}<p>Hi {{lead_first_name}},</p>
<p>Your bank line is valuable. It does not have to be the only source of capital you use to take on the next job or cover the costs that come before revenue.</p>
<p>My Business Solutions can review unsecured working-capital requests from <strong>$10,000 to $5,000,000</strong>, with funding in as little as 24 hours on bank statements alone for qualified businesses.</p>
<p>Capital can be used for inventory, payroll, operating expenses, marketing, expansion, or an upcoming job, and it does not touch your equipment line.</p>
<p>Underwriting and final terms depend on the business, requested amount, bank activity, credit profile, and supporting documentation.</p>
<p>Reply with the amount you are considering and when you need it, and I''ll help review the next step.</p>
<p>Best,<br><strong>Nate Ford</strong> | CEO<br>My Business Solutions<br>Call or text 602-245-5425<br><a href="mailto:nate@my-business-solutions.com">nate@my-business-solutions.com</a><br><a href="https://my-business-solutions.com">my-business-solutions.com</a></p>
<p style="font-size:12px;color:#64748b">Financing subject to credit approval and underwriting. Terms vary.</p>',
  'working_capital',
  'default',
  false
WHERE NOT EXISTS (
  SELECT 1 FROM email_templates WHERE name = 'Working Capital — Preserve Your Bank Line'
);

INSERT INTO collateral_templates (name, category, kind, source_key, status)
SELECT 'Working Capital — Take on the Job', 'flyer', 'image_overlay', 'mbs://campaign/working-capital', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM collateral_templates WHERE source_key = 'mbs://campaign/working-capital');

INSERT INTO collateral_templates (name, category, kind, source_key, status)
SELECT 'Equipment Financing — The Next Piece of Your Business', 'flyer', 'image_overlay', 'mbs://campaign/equipment-financing', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM collateral_templates WHERE source_key = 'mbs://campaign/equipment-financing');

-- This campaign is deliberately review-only. Keep any pre-existing rows with
-- the same canonical names/sources unavailable to live send and rep workflows
-- until an admin explicitly approves and activates/publishes them.
UPDATE email_templates
SET is_active = false, updated_at = now()
WHERE name IN (
  'Equipment Financing — Review Before You Buy',
  'Working Capital — Preserve Your Bank Line'
);

UPDATE collateral_templates
SET status = 'draft', updated_at = now()
WHERE source_key IN (
  'mbs://campaign/working-capital',
  'mbs://campaign/equipment-financing'
);