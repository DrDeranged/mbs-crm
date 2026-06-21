import { db } from "@workspace/db";
import {
  leadsTable,
  applicationsTable,
  bankStatementExtractionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

export interface ScoreCriterion {
  name: string;
  description: string;
  points: number;
  maxPoints: number;
  reason: string;
}

export interface LeadScoreBreakdown {
  criteria: ScoreCriterion[];
  total: number;
  scoredAt: string;
  dataAvailability: {
    hasBankStatements: boolean;
    hasApplication: boolean;
  };
}

function scoreMonthlyRevenue(avgMonthlyDeposits: number | null, statedMonthly: number | null): ScoreCriterion {
  const maxPoints = 25;
  const revenue = avgMonthlyDeposits ?? statedMonthly;
  let points = 0;
  let reason = "No revenue data available";

  if (revenue !== null) {
    const source = avgMonthlyDeposits !== null ? "bank statements" : "stated";
    if (revenue >= 50000) {
      points = 25;
      reason = `$${revenue.toLocaleString()}/mo avg from ${source} (≥$50k)`;
    } else if (revenue >= 25000) {
      points = 18;
      reason = `$${revenue.toLocaleString()}/mo avg from ${source} ($25k–$50k)`;
    } else if (revenue >= 10000) {
      points = 10;
      reason = `$${revenue.toLocaleString()}/mo avg from ${source} ($10k–$25k)`;
    } else if (revenue >= 5000) {
      points = 4;
      reason = `$${revenue.toLocaleString()}/mo avg from ${source} ($5k–$10k)`;
    } else {
      points = 0;
      reason = `$${revenue.toLocaleString()}/mo avg from ${source} (<$5k)`;
    }
  }

  return { name: "Monthly Revenue", description: "Average monthly deposits or stated revenue", points, maxPoints, reason };
}

function scoreAvgDailyBalance(avgBalance: number | null): ScoreCriterion {
  const maxPoints = 15;
  let points = 0;
  let reason = "No bank statement data available";

  if (avgBalance !== null) {
    if (avgBalance >= 10000) {
      points = 15;
      reason = `$${avgBalance.toLocaleString()} avg balance (≥$10k)`;
    } else if (avgBalance >= 5000) {
      points = 10;
      reason = `$${avgBalance.toLocaleString()} avg balance ($5k–$10k)`;
    } else if (avgBalance >= 2000) {
      points = 5;
      reason = `$${avgBalance.toLocaleString()} avg balance ($2k–$5k)`;
    } else if (avgBalance >= 1000) {
      points = 2;
      reason = `$${avgBalance.toLocaleString()} avg balance ($1k–$2k)`;
    } else {
      points = 0;
      reason = `$${avgBalance.toLocaleString()} avg balance (<$1k)`;
    }
  }

  return { name: "Average Daily Balance", description: "Average daily bank balance from statements", points, maxPoints, reason };
}

function scoreNsfHistory(avgNsfPerMonth: number | null): ScoreCriterion {
  const maxPoints = 15;
  let points = 0;
  let reason = "No bank statement data available";

  if (avgNsfPerMonth !== null) {
    if (avgNsfPerMonth === 0) {
      points = 15;
      reason = "No NSFs on record";
    } else if (avgNsfPerMonth <= 1) {
      points = 10;
      reason = `${avgNsfPerMonth.toFixed(1)} avg NSFs/mo (≤1)`;
    } else if (avgNsfPerMonth <= 3) {
      points = 5;
      reason = `${avgNsfPerMonth.toFixed(1)} avg NSFs/mo (1–3)`;
    } else {
      points = 0;
      reason = `${avgNsfPerMonth.toFixed(1)} avg NSFs/mo (>3)`;
    }
  }

  return { name: "NSF History", description: "Average monthly non-sufficient funds events", points, maxPoints, reason };
}

function scoreExistingPositions(positionCount: number | null): ScoreCriterion {
  const maxPoints = 15;
  let points = 0;
  let reason = "No position data available";

  if (positionCount !== null) {
    if (positionCount === 0) {
      points = 15;
      reason = "No existing MCA/loan positions";
    } else if (positionCount === 1) {
      points = 10;
      reason = "1 existing position";
    } else if (positionCount === 2) {
      points = 5;
      reason = "2 existing positions";
    } else {
      points = 0;
      reason = `${positionCount} existing positions (≥3)`;
    }
  }

  return { name: "Existing Positions", description: "Current MCA or loan positions detected", points, maxPoints, reason };
}

function scoreTimeInBusiness(months: number | null): ScoreCriterion {
  const maxPoints = 15;
  let points = 0;
  let reason = "Time in business not provided";

  if (months !== null) {
    if (months >= 36) {
      points = 15;
      reason = `${months} months in business (≥3 years)`;
    } else if (months >= 24) {
      points = 10;
      reason = `${months} months in business (2–3 years)`;
    } else if (months >= 12) {
      points = 6;
      reason = `${months} months in business (1–2 years)`;
    } else if (months >= 6) {
      points = 2;
      reason = `${months} months in business (6–12 months)`;
    } else {
      points = 0;
      reason = `${months} months in business (<6 months)`;
    }
  }

  return { name: "Time in Business", description: "How long the business has been operating", points, maxPoints, reason };
}

function scoreCompleteness(lead: typeof leadsTable.$inferSelect, hasApplication: boolean, hasSsn: boolean): ScoreCriterion {
  const maxPoints = 15;
  const keyFields = [
    lead.firstName,
    lead.lastName,
    lead.email,
    lead.phone,
    lead.companyName,
    lead.ein,
  ];
  const filledCount = keyFields.filter(Boolean).length;
  const appBonus = hasApplication ? 1 : 0;
  const ssnBonus = hasSsn ? 1 : 0;
  const totalScore = filledCount + appBonus + ssnBonus;
  const maxTotal = 8;

  let points = Math.round((totalScore / maxTotal) * 15);
  points = Math.min(points, 15);

  const reason = `${filledCount}/6 contact fields, ${hasApplication ? "application submitted" : "no application"}, ${hasSsn ? "SSN on file" : "no SSN"}`;

  return { name: "Application Completeness", description: "How complete the lead profile and application are", points, maxPoints, reason };
}

export async function calculateLeadScore(leadId: number): Promise<{ score: number; breakdown: LeadScoreBreakdown }> {
  const lead = await db.query.leadsTable.findFirst({ where: eq(leadsTable.id, leadId) });
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  const [extractions, application] = await Promise.all([
    db.query.bankStatementExtractionsTable.findMany({ where: eq(bankStatementExtractionsTable.leadId, leadId) }),
    db.query.applicationsTable.findFirst({ where: eq(applicationsTable.leadId, leadId) }),
  ]);

  const hasBankStatements = extractions.length > 0;
  const hasApplication = application !== undefined && application !== null;

  const withDeposits = extractions.filter((e) => e.totalDeposits !== null);
  const avgMonthlyDeposits = withDeposits.length > 0
    ? withDeposits.reduce((s, e) => s + parseFloat(String(e.totalDeposits)), 0) / withDeposits.length
    : null;

  const withBalance = extractions.filter((e) => e.averageDailyBalance !== null);
  const avgDailyBalance = withBalance.length > 0
    ? withBalance.reduce((s, e) => s + parseFloat(String(e.averageDailyBalance)), 0) / withBalance.length
    : null;

  const avgNsfPerMonth = extractions.length > 0
    ? extractions.reduce((s, e) => s + e.nsfCount, 0) / extractions.length
    : null;

  const totalPositions = extractions.reduce(
    (s, e) => s + ((e.existingPositionsJson as any[])?.length ?? 0),
    0
  );
  const existingPositionCount = hasBankStatements ? totalPositions : (lead.existingPositions ?? null);

  const statedMonthly = application?.monthlyRevenueStated ?? null;
  const timeInBusiness = application?.timeInBusinessMonths ?? null;
  const hasSsn = !!application?.ownerSsnEncrypted;

  const criteria: ScoreCriterion[] = [
    scoreMonthlyRevenue(avgMonthlyDeposits, statedMonthly),
    scoreAvgDailyBalance(avgDailyBalance),
    scoreNsfHistory(avgNsfPerMonth),
    scoreExistingPositions(existingPositionCount),
    scoreTimeInBusiness(timeInBusiness),
    scoreCompleteness(lead, hasApplication, hasSsn),
  ];

  const total = criteria.reduce((s, c) => s + c.points, 0);

  const breakdown: LeadScoreBreakdown = {
    criteria,
    total,
    scoredAt: new Date().toISOString(),
    dataAvailability: { hasBankStatements, hasApplication },
  };

  await db.update(leadsTable)
    .set({ leadScore: total, leadScoreBreakdown: breakdown as any, updatedAt: new Date() })
    .where(eq(leadsTable.id, leadId));

  return { score: total, breakdown };
}
