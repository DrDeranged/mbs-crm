# GitHub main 6f7c861 browser certification

Commit proof: 6f7c8611ed4087a14e62ff99a0f5dbb5f3b33835; 963 committed files matched; published: false. Target: .local/certification-6f7c861/target. Comparison baseline: .local/certification-2af927c/baselines/target-2af927c.

- **Mobile inventory: FAIL — 30/36 exact against the certified inventory.** All 36 fresh target/baseline controls and exemptions match exactly. Six Leads keys (390/768 × admin/manager/rep) differ from the 2026-10-03 certified inventory only in relative-date labels: “19d idle” vs “18d idle” and “20 days ago” vs “19 days ago.” This reflects the current fixture clock vs. the inventory capture date; no controls were added and no new exemptions were made. Full expected/actual item diffs are in mobile-comparisons.json.

- **Theme-toggle buttons below 1024: PASS** — zero matches at 390, 768 and 1023 for each role, counting hidden DOM elements too.

- **Baseline assets: PASS** — 0 missing files; baseline HTML document navigation, accept:text/html polling and static assets used retained bytes; /api remained fixture-backed.

- **Tables at 1280/1366:** Leads horizontal scrolling **yes, contained to table** for collapsed and pinned states; whole page does not scroll horizontally. Deals horizontal scrolling **no** for collapsed and pinned at both widths; whole page does not scroll. Existing fixture rows were synthetic. Geometry/details and eight screenshots are in table-geometry.json and screenshots/.

- **Theme: PASS (10/10)** — fresh account + OS dark defaults Light; Enter toggles Dark and Space toggles Light with matching aria labels and stored preference; 768px Settings selector reflects/changes both modes; desktop Settings selector is absent; header state and selected mode persist through reload for Dark and Light. No cross-device/server sync is asserted.

- **App render errors: none.** Browser log is bounded and sanitized; no missing baseline assets.

- **Concurrent full preflight: FAIL** (separate from browser checks), exit code 1 during stage 4/11 full suite. The failing email provider tests require PUBLIC_APP_URL and saw HTTP 500 vs expected 200. See preflight-result.json and preflight-tail.txt.

Evidence: reproduce-browser.mjs, mobile-comparisons.json, table-geometry.json, theme-assertions.json, browser-log.json, screenshots/. Synthetic disposable fixture used; no app source, workflows, packages or real CRM records were changed; no publish/push occurred. Fixture users/database and browser context were cleaned up in finally.