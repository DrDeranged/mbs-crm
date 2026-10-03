import { BarChart3, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetLeadFinancials } from "@workspace/api-client-react";
import { useLeadDetail } from "./context";
export function LeadFinancials() {
  const { id: leadId } = useLeadDetail();
  const { data, isLoading } = useGetLeadFinancials(leadId);

  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  if (!data || data.months.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6 space-y-2">
              <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground font-medium">No bank statement data</p>
              <p className="text-sm text-muted-foreground">Bank statement extractions will appear here once the applicant submits their application with PDF statements.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { months, summary } = data;
  const fmt = (v: number | null | undefined) => v != null ? `$${Math.round(v).toLocaleString()}` : "—";

  // Health indicator: green = 0 NSF/month, yellow = 1–4, red = >4
  const healthScore = summary
    ? summary.avgNsfsPerMonth === 0 ? "green"
      : summary.avgNsfsPerMonth <= 4 ? "yellow"
      : "red"
    : null;

  const healthLabel = { green: "Strong", yellow: "Fair", red: "High Risk" } as const;
  const healthColors = {
    green: "bg-success-bg text-success border-success/30",
    yellow: "bg-warning-bg text-warning border-warning/30",
    red: "bg-danger-bg text-danger border-danger/30",
  } as const;

  return (
    <div className="p-4 space-y-4">
      {/* Health indicator */}
      {healthScore && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${healthColors[healthScore]}`}>
          <div className={`h-3 w-3 rounded-full flex-shrink-0 ${healthScore === "green" ? "bg-chart-1" : healthScore === "yellow" ? "bg-chart-3" : "bg-chart-4"}`} />
          <div>
            <p className="font-semibold text-sm">{healthLabel[healthScore]} — {healthScore === "green" ? "No NSF activity detected" : healthScore === "yellow" ? `Avg ${summary!.avgNsfsPerMonth.toFixed(1)} NSF/month` : `High NSF rate: ${summary!.avgNsfsPerMonth.toFixed(1)}/month`}</p>
            <p className="text-xs opacity-75">Based on {summary!.monthsAnalyzed} month(s) of statements · {summary!.positionsDetected} existing position(s) detected</p>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">Avg Monthly Deposits</p>
              <p className="text-lg font-bold text-info">{fmt(summary.avgMonthlyDeposits)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">Avg Daily Balance</p>
              <p className="text-lg font-bold text-foreground">{fmt(summary.avgDailyBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">Months Analyzed</p>
              <p className="text-lg font-bold text-foreground">{summary.monthsAnalyzed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">Total NSFs</p>
              <p className={`text-lg font-bold ${summary.totalNsfs > 3 ? "text-danger" : "text-foreground"}`}>{summary.totalNsfs}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly breakdown table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-foreground">Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium">Period</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Total Deposits</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Avg Daily Bal</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">NSFs</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium">Neg. Days</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted">
                    <td className="px-4 py-2 font-medium text-foreground">
                      {m.statementYear && m.statementMonth
                        ? `${MONTH_NAMES[(m.statementMonth - 1) % 12]} ${m.statementYear}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-info font-medium">{fmt(m.totalDeposits)}</td>
                    <td className="px-4 py-2 text-right">{fmt(m.averageDailyBalance)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${m.nsfCount > 1 ? "text-danger" : "text-foreground"}`}>{m.nsfCount}</td>
                    <td className={`px-4 py-2 text-right ${m.negativeBalanceDays > 3 ? "text-warning" : "text-foreground"}`}>{m.negativeBalanceDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Existing positions */}
      {months.some((m) => m.existingPositions.length > 0) && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm text-foreground">Existing Positions Detected</CardTitle>
            <CardDescription className="text-xs">MCA or loan payments found in bank statements</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {months.flatMap((m) => m.existingPositions).map((p, i) => (
                <div key={i} className="flex justify-between items-center text-xs bg-warning-bg rounded-lg px-3 py-2">
                  <span className="text-foreground">{p.description}</span>
                  <div className="text-right">
                    <span className="font-medium text-warning">{fmt(p.amount)}</span>
                    <span className="text-muted-foreground ml-1">/ {p.frequency}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
