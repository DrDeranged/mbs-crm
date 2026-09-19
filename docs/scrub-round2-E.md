# Production scrub round 2 — E. Re-application

| Requirement | Status | Evidence |
| --- | --- | --- |
| A public application matching an existing email or phone reuses that lead rather than returning 409 or creating a lead. | PASS | `artifacts/api-server/src/routes/applications.ts:248-281`; `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:205-231` |
| Email matching is case-insensitive and phone matching ignores presentation punctuation. | PASS | `artifacts/api-server/src/routes/applications.ts:169-173,255-264`; fixtures at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:205-210,234-255` |
| An email and phone that identify separate leads cannot attach an application to either lead. | PASS | `artifacts/api-server/src/routes/applications.ts:255-267,584-591`; `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:257-269` asserts named `400` and zero writes. |
| A second application writes the exact activity action `Re-application submitted`. | PASS | `artifacts/api-server/src/routes/applications.ts:273-280`; assertion at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:220-224` |
| The existing lead's assigned representative is notified of a re-application. | PASS | `artifacts/api-server/src/routes/applications.ts:508-522`; assertion at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:225-231` |
| Application/document records attach to the existing lead and the normal public success payload is returned without an existing tracking token. | PASS | `artifacts/api-server/src/routes/applications.ts:309-390,515-582`; assertions at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:215-219,250-254` |
| A phone-only match sends a confirmation only to the existing lead's stored email, not an unverified submitted address. | PASS | `artifacts/api-server/src/routes/applications.ts:514-519,553-565`; `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:234-255` |
| Each historical application keeps its own signed-document pointer, and every reader selects the latest application deterministically. | PASS | Update predicate at `artifacts/api-server/src/routes/applications.ts:457-459`; predicate-aware two-application assertion at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:271-290`; reader ordering in `applications.ts:622-625`, `matchingEngine.ts:35-38`, and `lenderPackage.ts:826-830,960-964`. |
| Parallel requests sharing an email or phone cannot pass separate lookup/insert races. | PASS | `artifacts/api-server/src/routes/applications.ts:234-264` uses stable-order transaction advisory locks; lock assertion at `artifacts/api-server/src/lib/applicationSubmitRoute.test.ts:217` |

Focused verification: `node --test --experimental-strip-types --loader ./test-loader.mjs src/lib/applicationSubmitRoute.test.ts` — 5 passed, 0 failed.

No migration was required: the existing schema has non-unique indexed email/phone columns, and transaction advisory locks serialize the check and attachment safely without changing migrations 001–022.