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
        <Loader2 className="h-6 w-6 animate-spin text-[#1F4E79]" />
      </div>
    );
  }

  if (!data || data.months.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6 space-y-2">
              <BarChart3 className="h-10 w-10 text-gray-300 mx-auto" />
              <p className="text-gray-500 font-medium">No bank statement data</p>
              <p className="text-sm text-gray-400">Bank statement extractions will appear here once the applicant submits their application with PDF statements.</p>
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
    green: "bg-green-100 text-green-700 border-green-200",
    yellow: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
  } as const;

  return (
    <div className="p-4 space-y-4">
      {/* Health indicator */}
      {healthScore && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${healthColors[healthScore]}`}>
          <div className={`h-3 w-3 rounded-full flex-shrink-0 ${healthScore === "green" ? "bg-green-500" : healthScore === "yellow" ? "bg-amber-500" : "bg-red-500"}`} />
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
              <p className="text-xs text-gray-400">Avg Monthly Deposits</p>
              <p className="text-lg font-bold text-[#1F4E79]">{fmt(summary.avgMonthlyDeposits)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Avg Daily Balance</p>
              <p className="text-lg font-bold text-gray-900">{fmt(summary.avgDailyBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Months Analyzed</p>
              <p className="text-lg font-bold text-gray-900">{summary.monthsAnalyzed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-gray-400">Total NSFs</p>
              <p className={`text-lg font-bold ${summary.totalNsfs > 3 ? "text-red-600" : "text-gray-900"}`}>{summary.totalNsfs}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly breakdown table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm text-gray-700">Monthly Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-2 text-gray-500 font-medium">Period</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Total Deposits</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Avg Daily Bal</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">NSFs</th>
                  <th className="text-right px-4 py-2 text-gray-500 font-medium">Neg. Days</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-gray-700">
                      {m.statementYear && m.statementMonth
                        ? `${MONTH_NAMES[(m.statementMonth - 1) % 12]} ${m.statementYear}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-[#1F4E79] font-medium">{fmt(m.totalDeposits)}</td>
                    <td className="px-4 py-2 text-right">{fmt(m.averageDailyBalance)}</td>
                    <td className={`px-4 py-2 text-right font-medium ${m.nsfCount > 1 ? "text-red-600" : "text-gray-700"}`}>{m.nsfCount}</td>
                    <td className={`px-4 py-2 text-right ${m.negativeBalanceDays > 3 ? "text-amber-600" : "text-gray-700"}`}>{m.negativeBalanceDays}</td>
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
            <CardTitle className="text-sm text-gray-700">Existing Positions Detected</CardTitle>
            <CardDescription className="text-xs">MCA or loan payments found in bank statements</CardDescription>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2">
              {months.flatMap((m) => m.existingPositions).map((p, i) => (
                <div key={i} className="flex justify-between items-center text-xs bg-amber-50 rounded-lg px-3 py-2">
                  <span className="text-gray-700">{p.description}</span>
                  <div className="text-right">
                    <span className="font-medium text-amber-700">{fmt(p.amount)}</span>
                    <span className="text-gray-400 ml-1">/ {p.frequency}</span>
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
