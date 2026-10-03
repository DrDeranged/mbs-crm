const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Exact fixture-specific edits, NOT a selector/attribute wildcard. Every other
// descriptor retains its original position. Baseline drift also fails closed.
export function compareApproved(key, before, after, beforeExempt, afterExempt, manifest) {
  const rules = manifest.keys[key];
  if (!rules) throw new Error(`No approved structural contract for ${key}`);
  const expected = structuredClone(before);
  const failures = [];
  for (const edit of [...rules.replacements].reverse()) {
    const actual = expected.slice(edit.index, edit.index + edit.before.length);
    if (!equal(actual, edit.before)) failures.push({ kind: "baseline-drift", index: edit.index, expected: edit.before, actual });
    expected.splice(edit.index, edit.before.length, ...edit.after);
  }
  for (const [phase, actual, allowed] of [
    ["before", beforeExempt, rules.beforeExempt],
    ["after", afterExempt, rules.afterExempt],
  ]) {
    if (!equal(actual, allowed)) failures.push({ kind: "unapproved-exempt-controls", phase, expected: allowed, actual });
  }
  // Include removals at the end or an entirely empty inventory, unlike the old
  // after.flatMap comparison which could silently omit missing controls.
  for (let index = 0; index < Math.max(expected.length, after.length); index++) {
    if (!equal(expected[index], after[index])) failures.push({ kind: "unapproved-control-difference", index, expected: expected[index] ?? null, actual: after[index] ?? null });
  }
  const dashboardAudit = key.startsWith("dashboard-") ? {
    countUnchanged: before.length === after.length,
    descriptorsExceptNameUnchangedAtEveryIndex: before.length === after.length &&
      before.every((item, i) => equal({ ...item, name: null }, { ...after[i], name: null })),
    labels: before.flatMap((item, index) => item.name === after[index]?.name ? [] : [
      { index, tag: item.tag, before: item.name, after: after[index]?.name },
    ]),
  } : undefined;
  if (dashboardAudit && (!dashboardAudit.countUnchanged || !dashboardAudit.descriptorsExceptNameUnchangedAtEveryIndex)) {
    failures.push({ kind: "dashboard-removed-reordered-or-changed-control", audit: dashboardAudit });
  }
  return {
    key, passed: failures.length === 0, beforeCount: before.length, afterCount: after.length,
    approvedReplacementSpans: rules.replacements.length,
    approvedExemptControls: afterExempt.length, differences: failures,
    ...(dashboardAudit ? { dashboardAudit } : {}),
  };
}