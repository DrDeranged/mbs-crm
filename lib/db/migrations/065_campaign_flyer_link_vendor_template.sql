-- Keep the delivery behavior of previously saved campaigns; newly created campaigns default to links.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'campaigns' AND column_name = 'flyer_delivery_mode') THEN
    ALTER TABLE campaigns ADD COLUMN flyer_delivery_mode text NOT NULL DEFAULT 'link';
    UPDATE campaigns SET flyer_delivery_mode = 'attach';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_flyer_delivery_mode_check') THEN
    ALTER TABLE campaigns ADD CONSTRAINT campaigns_flyer_delivery_mode_check
      CHECK (flyer_delivery_mode IN ('attach', 'link'));
  END IF;
END $$;

INSERT INTO email_templates (name, subject, body_html, program_type, sender_mode, is_active)
SELECT 'Vendor Program — Equipment Financing',
       'Financing for your {{vertical}} buyers',
       'Hi {{first_name|there}},

I run My Business Solutions, a commercial equipment finance brokerage. We work with a lot of {{vertical}} buyers — especially the ones a captive or bank program turns down: newer businesses, challenged credit, owner-operators.

If a buyer at {{company}} ever stalls on financing, we can usually get an answer the same day, and you''re paid in full on delivery. No cost to you — we just help the sale close.

{{flyer_link}}

Worth a five-minute call? I''m at 908-860-8507.

Nate Ford
CEO | My Business Solutions',
       'equipment', 'default', true
WHERE NOT EXISTS (SELECT 1 FROM email_templates WHERE name = 'Vendor Program — Equipment Financing');