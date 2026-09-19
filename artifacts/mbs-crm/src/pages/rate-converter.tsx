import { useState, useMemo } from "react";
import { PageContainer, PageHeader } from "@/components/ui/page-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Percent, CircleDollarSign } from "lucide-react";
import {
  calculateAmortization,
  calculateMca,
  type LoanSourceType,
  type McaSourceType,
  type McaPeriodType,
} from "@/lib/rateConverter";

function formatCurrency(val: number) {
  if (!Number.isFinite(val)) return "---";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function formatPercent(val: number) {
  if (!Number.isFinite(val)) return "---";
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}

function formatInputNumber(value: number, digits = 4) {
  return Number(value.toFixed(digits)).toString();
}

function StatBox({
  label,
  value,
  highlight = false,
  subtext,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  subtext?: string;
}) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? "bg-primary/5 border-primary/20" : "bg-white dark:bg-black/20 border-border"} flex flex-col gap-1`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tracking-tight ${highlight ? 'text-primary' : 'text-foreground'}`}>{value}</div>
      {subtext ? <div className="text-xs text-muted-foreground mt-1">{subtext}</div> : null}
    </div>
  );
}

export default function RateConverterPage() {
  // Amortization State
  const [amortTerm, setAmortTerm] = useState("12");
  const [amortSourceType, setAmortSourceType] = useState<LoanSourceType>("nominalApr");
  const [amortSourceValue, setAmortSourceValue] = useState("15");

  const amortResult = useMemo(() => {
    const term = parseFloat(amortTerm);
    let val = parseFloat(amortSourceValue);
    if (Number.isNaN(term) || Number.isNaN(val)) return null;
    val = val / 100; // percent to decimal
    return calculateAmortization(term, val, amortSourceType);
  }, [amortTerm, amortSourceType, amortSourceValue]);

  const handleAmortSourceChange = (nextSource: LoanSourceType) => {
    if (amortResult) {
      const equivalent = {
        nominalApr: amortResult.nominalApr,
        effectiveApr: amortResult.effectiveApr,
        simpleInterestRate: amortResult.simpleInterestRate,
      }[nextSource];
      setAmortSourceValue(formatInputNumber(equivalent * 100));
    }
    setAmortSourceType(nextSource);
  };

  // MCA State
  const [mcaTerm, setMcaTerm] = useState("6");
  const [mcaPeriodType, setMcaPeriodType] = useState<McaPeriodType>("months");
  const [mcaSourceType, setMcaSourceType] = useState<McaSourceType>("factor");
  const [mcaSourceValue, setMcaSourceValue] = useState("1.25");

  const mcaResult = useMemo(() => {
    const term = parseFloat(mcaTerm);
    let val = parseFloat(mcaSourceValue);
    if (Number.isNaN(term) || Number.isNaN(val)) return null;
    if (mcaSourceType === "apr") val = val / 100;
    return calculateMca(term, mcaPeriodType, val, mcaSourceType);
  }, [mcaTerm, mcaPeriodType, mcaSourceType, mcaSourceValue]);

  const handleMcaSourceChange = (nextSource: McaSourceType) => {
    if (mcaResult) {
      setMcaSourceValue(
        nextSource === "factor"
          ? formatInputNumber(mcaResult.factor)
          : formatInputNumber(mcaResult.impliedNominalApr * 100),
      );
    }
    setMcaSourceType(nextSource);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Rate Converter"
        subtitle="Quickly translate between factor rates, APR, and simple interest for precise comparisons."
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Amortizing Loan Card */}
        <Card className="shadow-md border-border overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-[#17A567] to-[#149258]" />
          <CardHeader className="bg-secondary/10 pb-6 border-b">
            <CardTitle className="flex items-center gap-2 text-xl">
              <Percent className="h-5 w-5 text-primary" />
              Amortizing Loan
            </CardTitle>
            <CardDescription>
              Convert between Nominal APR, Effective APR, and Simple Interest based on standard end-of-month amortization.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex flex-col md:flex-row">
            {/* Input Section */}
            <div className="p-6 flex-1 space-y-5 border-r border-border bg-white dark:bg-card">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Term (Months)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={amortTerm}
                    onChange={(e) => setAmortTerm(e.target.value)}
                    placeholder="e.g. 12"
                    className="font-medium text-lg h-12"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">mo</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Source Rate</Label>
                <Select value={amortSourceType} onValueChange={(v) => handleAmortSourceChange(v as LoanSourceType)}>
                  <SelectTrigger className="h-12 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nominalApr">Nominal APR</SelectItem>
                    <SelectItem value="effectiveApr">Effective APR</SelectItem>
                    <SelectItem value="simpleInterestRate">Simple Interest Rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {amortSourceType === "nominalApr" && "Nominal APR (%)"}
                  {amortSourceType === "effectiveApr" && "Effective APR (%)"}
                  {amortSourceType === "simpleInterestRate" && "Simple Interest (%)"}
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={amortSourceValue}
                    onChange={(e) => setAmortSourceValue(e.target.value)}
                    placeholder="e.g. 15"
                    className="font-medium text-lg h-12 pl-10"
                    step="0.01"
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">%</div>
                </div>
              </div>
            </div>

            {/* Results Section */}
            <div className="p-6 flex-1 bg-secondary/5 space-y-4">
              <StatBox
                label="Monthly Payment / $10k"
                value={amortResult ? formatCurrency(amortResult.monthlyPaymentPer10k) : "---"}
                highlight
                subtext="Assuming ordinary end-of-month payments"
              />
              <div className="grid grid-cols-2 gap-4">
                <StatBox
                  label="Nominal APR"
                  value={amortResult ? formatPercent(amortResult.nominalApr) : "---"}
                />
                <StatBox
                  label="Effective APR"
                  value={amortResult ? formatPercent(amortResult.effectiveApr) : "---"}
                />
                <StatBox
                  label="Simple Interest"
                  value={amortResult ? formatPercent(amortResult.simpleInterestRate) : "---"}
                />
                <StatBox
                  label="Total Payback"
                  value={amortResult ? formatCurrency(amortResult.totalPaybackPer10k) : "---"}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Nominal APR annualizes the monthly rate, effective APR includes monthly compounding,
                and simple interest spreads the total finance charge evenly across the term.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* MCA Card */}
        <Card className="shadow-md border-border overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-[#0E2A47] to-[#1F4E79]" />
          <CardHeader className="bg-secondary/10 pb-6 border-b">
            <CardTitle className="flex items-center gap-2 text-xl">
              <CircleDollarSign className="h-5 w-5 text-[#0E2A47] dark:text-gray-300" />
              MCA Converter
            </CardTitle>
            <CardDescription>
              Convert between Factor Rates and implied Nominal APR for fixed-payment advances.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 flex flex-col md:flex-row">
            {/* Input Section */}
            <div className="p-6 flex-1 space-y-5 border-r border-border bg-white dark:bg-card">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Term</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={mcaTerm}
                    onChange={(e) => setMcaTerm(e.target.value)}
                    placeholder="e.g. 6"
                    className="font-medium text-lg h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Period</Label>
                  <Select value={mcaPeriodType} onValueChange={(v) => setMcaPeriodType(v as McaPeriodType)}>
                    <SelectTrigger className="h-12 font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="months">Months</SelectItem>
                      <SelectItem value="weeks">Weeks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Source Rate</Label>
                <Select
                  value={mcaSourceType}
                  onValueChange={(v) => handleMcaSourceChange(v as McaSourceType)}
                >
                  <SelectTrigger className="h-12 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="factor">Factor Rate (e.g. 1.25)</SelectItem>
                    <SelectItem value="apr">Implied Nominal APR (%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  {mcaSourceType === "factor" ? "Factor Rate" : "Nominal APR (%)"}
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={mcaSourceType === "factor" ? "1" : "0"}
                    value={mcaSourceValue}
                    onChange={(e) => setMcaSourceValue(e.target.value)}
                    placeholder={mcaSourceType === "factor" ? "e.g. 1.25" : "e.g. 45"}
                    className={`font-medium text-lg h-12 ${mcaSourceType === "apr" ? "pl-10" : ""}`}
                    step={mcaSourceType === "factor" ? "0.01" : "0.01"}
                  />
                  {mcaSourceType === "apr" ? <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-lg">%</div> : null}
                  {mcaSourceType === "factor" ? <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">x</div> : null}
                </div>
              </div>
            </div>

            {/* Results Section */}
            <div className="p-6 flex-1 bg-secondary/5 space-y-4">
              <StatBox
                label={`Payment / $10k / ${mcaPeriodType === "weeks" ? "Week" : "Month"}`}
                value={mcaResult ? formatCurrency(mcaResult.periodicPaymentPer10k) : "---"}
                highlight
                subtext={`Assuming equal ${mcaPeriodType === "weeks" ? "weekly" : "monthly"} payments`}
              />
              <div className="grid grid-cols-2 gap-4">
                <StatBox
                  label="Factor Rate"
                  value={mcaResult ? mcaResult.factor.toFixed(4) + "x" : "---"}
                />
                <StatBox
                  label="Implied APR"
                  value={mcaResult ? formatPercent(mcaResult.impliedNominalApr) : "---"}
                />
                <StatBox
                  label="Total Payback"
                  value={mcaResult ? formatCurrency(mcaResult.totalPaybackPer10k) : "---"}
                />
                <StatBox
                  label="Cost of Capital"
                  value={mcaResult ? formatCurrency(mcaResult.totalPaybackPer10k - 10000) : "---"}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
