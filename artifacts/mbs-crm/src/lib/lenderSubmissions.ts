export type SubmissionLike = { status: string };

export function submissionSummary(submissions: SubmissionLike[]) {
  const approved = submissions.filter((s) => s.status === "approved").length;
  const declined = submissions.filter((s) => s.status === "declined").length;
  const pending = submissions.filter((s) => !["approved", "declined", "funded", "withdrawn"].includes(s.status)).length;
  return { total: submissions.length, approved, declined, pending, text: `Submitted to ${submissions.length} · ${approved} approved · ${declined} declined · ${pending} pending` };
}

export function filterDeclinedMatches<T extends { lenderId: number }>(matches: T[], submissions: Array<SubmissionLike & { lenderId: number }>, showDeclined = false) {
  if (showDeclined) return matches;
  const declined = new Set(submissions.filter((s) => s.status === "declined").map((s) => s.lenderId));
  return matches.filter((match) => !declined.has(match.lenderId));
}

export function shouldPromptForStage(submissions: SubmissionLike[], nextStatus: string) {
  if (nextStatus === "approved") return { stage: "approved" as const, prompt: true };
  if (nextStatus === "declined" && submissions.length > 0 && submissions.every((s) => s.status === "declined")) return { stage: "declined" as const, prompt: true };
  return { stage: null, prompt: false };
}