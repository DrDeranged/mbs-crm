import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  baseURL: process.env["AI_INTEGRATIONS_ANTHROPIC_BASE_URL"],
  apiKey: process.env["AI_INTEGRATIONS_ANTHROPIC_API_KEY"] ?? "dummy",
});

export interface ExistingPosition {
  amount: number;
  frequency: string;
  description: string;
}

export interface BankStatementOcrResult {
  statementMonth: number | null;
  statementYear: number | null;
  totalDeposits: number | null;
  averageDailyBalance: number | null;
  nsfCount: number;
  negativeBalanceDays: number;
  existingPositions: ExistingPosition[];
  rawExtractionJson: Record<string, unknown>;
}

const EXTRACTION_PROMPT = `You are a financial analyst extracting data from a bank statement PDF. 
Analyze the text and extract the following information.

Return ONLY valid JSON with this exact structure:
{
  "statement_month": <1-12 integer or null>,
  "statement_year": <4-digit integer or null>,
  "total_deposits": <total deposits for the month as number or null>,
  "average_daily_balance": <average daily balance as number or null>,
  "nsf_count": <number of NSF/insufficient funds items, default 0>,
  "negative_balance_days": <number of days with negative balance, default 0>,
  "existing_positions": [
    {
      "amount": <daily/weekly debit amount as number>,
      "frequency": "<daily|weekly|bi-weekly|monthly>",
      "description": "<merchant/lender name>"
    }
  ]
}

Rules:
- existing_positions: only include recurring daily or weekly debits that look like MCA/loan payments (e.g. "ACH DEBIT", "MERCHANT CASH", "FUNDING", daily small consistent amounts)
- If you cannot determine a value, use null (0 for counts)
- Do not include any text outside the JSON object

Bank statement text:
`;

export async function extractBankStatement(pdfBuffer: Buffer): Promise<BankStatementOcrResult> {
  let pdfText = "";
  try {
    // Dynamic import to avoid ESM/CJS interop issues with pdf-parse
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("pdf-parse");
    const parseFn = mod.default ?? mod;
    const parsed = await parseFn(pdfBuffer);
    pdfText = parsed.text ?? "";
  } catch {
    pdfText = "[PDF text extraction failed — binary content]";
  }

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: EXTRACTION_PROMPT + pdfText.slice(0, 12000),
      },
    ],
  });

  const rawText = message.content[0]?.type === "text" ? message.content[0].text : "{}";

  let parsed: Record<string, unknown> = {};
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
  } catch {
    parsed = {};
  }

  return {
    statementMonth: typeof parsed["statement_month"] === "number" ? parsed["statement_month"] : null,
    statementYear: typeof parsed["statement_year"] === "number" ? parsed["statement_year"] : null,
    totalDeposits: typeof parsed["total_deposits"] === "number" ? parsed["total_deposits"] : null,
    averageDailyBalance: typeof parsed["average_daily_balance"] === "number" ? parsed["average_daily_balance"] : null,
    nsfCount: typeof parsed["nsf_count"] === "number" ? parsed["nsf_count"] : 0,
    negativeBalanceDays: typeof parsed["negative_balance_days"] === "number" ? parsed["negative_balance_days"] : 0,
    existingPositions: Array.isArray(parsed["existing_positions"])
      ? (parsed["existing_positions"] as ExistingPosition[])
      : [],
    rawExtractionJson: parsed,
  };
}
