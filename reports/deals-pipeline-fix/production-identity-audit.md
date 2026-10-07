# Read-only production identity audit

The production read replica returned 30 stored deals: 26 with no linked lead and
four with a linked lead and company name. No missing referenced lead was found.
All 26 unlinked records have a stored non-numbered business/deal label.
Counts cover stored records, not a claim about the current filtered screenshot.
No production record was changed and no customer contact details are included.

| Stage | Stored deals | No linked lead | Linked company present |
|---|---:|---:|---:|
| approved | 4 | 3 | 1 |
| dead | 5 | 5 | 0 |
| declined | 2 | 2 | 0 |
| funded | 6 | 5 | 1 |
| hold_on | 1 | 1 | 0 |
| in_funding | 4 | 3 | 1 |
| information_needed | 1 | 1 | 0 |
| submitted | 6 | 5 | 1 |
| waiting_on_app | 1 | 1 | 0 |

The legacy pipeline seed creates financial deal records with a business label,
but does not create a lead association. The identity projection previously
discarded the stored label and returned “Deal” whenever linked-lead identity
was absent. The fix preserves the authorized deal-owned label for unlinked
records only. It does not fabricate company/contact fields, associate customers
by name, or reveal stored labels when a referenced lead is inaccessible.
