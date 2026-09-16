# I — Production data hygiene (read-only)

Observed 2026-09-16 using the production read-only SQL interface. Only metadata SELECTs and the aggregate SELECT below were executed. No rows, schema, or configuration were changed. Counts are a point-in-time observation, not a continuing guarantee.

| Check | Count | Status |
|---|---:|---|
| Leads with `lead_source IS NULL` | 0 | PASS |
| Documents categorized `other` with statement-like filenames | 0 | PASS |
| Users with role `pending` | 0 | PASS |
| Deals with no `assigned_to` | 4 | FAIL — administrator review needed |
| Leads without a company row | 5 | FAIL — administrator review needed |

The filename check is deliberately a documented heuristic, not a claim about the contents of the uploaded files.

## Exact SQL executed

```sql
SELECT 'leads_null_source' AS check_name, count(*) AS count
FROM leads WHERE lead_source IS NULL
UNION ALL
SELECT 'other_documents_statement_filename', count(*)
FROM documents
WHERE category = 'other'
  AND filename ~* '(statement|bank[ _-]*stmt|(^|[^a-z])stmt([^a-z]|$))'
UNION ALL
SELECT 'pending_users', count(*) FROM users WHERE role = 'pending'
UNION ALL
SELECT 'deals_unassigned', count(*) FROM deals WHERE assigned_to IS NULL
UNION ALL
SELECT 'leads_without_company', count(*)
FROM leads l
WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.lead_id = l.id);
```

## Recorded result

```text
check_name,count
leads_null_source,0
other_documents_statement_filename,0
pending_users,0
deals_unassigned,4
leads_without_company,5
```

No personal identifiers or document filenames were retrieved. Findings are left for administrators to review by hand, as requested.