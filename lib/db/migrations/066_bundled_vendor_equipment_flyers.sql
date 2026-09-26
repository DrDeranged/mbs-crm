-- Ship Nate's four approved vendor PNGs as immutable, signed-link-capable
-- library rows. The PNG bytes live in the API artifact's assets/campaigns
-- directory and are copied into the deployment bundle.
WITH bundled(source_key, name, vertical, filename, digest, size) AS (
  VALUES
    ('mbs://campaign/vendor-equipment-yellow-iron', 'Equipment Financing — Yellow Iron — Nate Ford', 'yellow_iron', 'vendor-equipment-yellow-iron.png', 'b06fb1de80e77e9174f43c028dbc18a35df254c090130c8e09958484ee77826d', 173267),
    ('mbs://campaign/vendor-equipment-trucking', 'Equipment Financing — Trucking — Nate Ford', 'trucking', 'vendor-equipment-trucking.png', 'b1484648fde8e255e352d9cd6bc772fd52b70910c195ce6658a1bb5f784b11ed', 173962),
    ('mbs://campaign/vendor-equipment-restaurants', 'Equipment Financing — Restaurants — Nate Ford', 'restaurants', 'vendor-equipment-restaurants.png', '3478e2ee8b2e5e795ebf9feee21a93fbc3d21d54bc21f693f491961afb086632', 185410),
    ('mbs://campaign/vendor-equipment-amusement', 'Equipment Financing — Amusement — Nate Ford', 'amusement', 'vendor-equipment-amusement.png', '879215ac98cfa18a132b331a5a21d3529721c26aaf1f6e4fb682f47589851579', 173436)
)
INSERT INTO collateral_templates (
  name, category, kind, source_key, status,
  campaign_category, vertical, audience, rep_user_id, original_filename,
  asset_sha256, asset_content_type, asset_generation, asset_size
)
SELECT bundled.name, 'flyer', 'image_overlay', bundled.source_key, 'published',
       'equipment_financing', bundled.vertical, 'vendor',
       (SELECT id FROM users WHERE lower(email) = 'nate@my-business-solutions.com' LIMIT 1),
       bundled.filename, bundled.digest, 'image/png', 'built-in', bundled.size
FROM bundled
WHERE NOT EXISTS (
  SELECT 1 FROM collateral_templates WHERE source_key = bundled.source_key
);