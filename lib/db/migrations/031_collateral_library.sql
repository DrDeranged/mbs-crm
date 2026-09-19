CREATE TABLE collateral_templates (
  id serial PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('flyer', 'one_pager', 'application', 'letter', 'other')),
  kind text NOT NULL CHECK (kind IN ('html', 'image_overlay')),
  source_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX collateral_templates_status_idx ON collateral_templates(status);
CREATE INDEX collateral_templates_category_idx ON collateral_templates(category);

CREATE TABLE collateral_renders (
  id serial PRIMARY KEY,
  template_id integer NOT NULL REFERENCES collateral_templates(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id integer REFERENCES leads(id) ON DELETE SET NULL,
  file_key text NOT NULL,
  sha256 text NOT NULL,
  rendered_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX collateral_renders_template_idx ON collateral_renders(template_id);
CREATE INDEX collateral_renders_user_idx ON collateral_renders(user_id);
CREATE INDEX collateral_renders_lead_idx ON collateral_renders(lead_id);
CREATE INDEX collateral_renders_cache_idx ON collateral_renders(template_id, user_id, sha256);

-- Keep the legacy flyer tables available to existing routes while making every
-- existing template available through the new collateral library.
INSERT INTO collateral_templates (
  name,
  category,
  kind,
  source_key,
  status,
  created_by,
  created_at,
  updated_at
)
SELECT
  name,
  'flyer',
  'image_overlay',
  html_template,
  'published',
  created_by,
  created_at,
  updated_at
FROM flyer_templates;