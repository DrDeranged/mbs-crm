import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getGetDealQueryKey,
  getListDealActivityQueryKey,
  getListDealApprovalsQueryKey,
  getListDealsQueryKey,
  useGetDeal,
  useListDealApprovals,
  useSaveDealRatePoints,
} from "@workspace/api-client-react";
import { ArrowLeft, Calculator, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { latestApproval } from "@/lib/dealApproval";
import { calculateRatePoints, parseDealRatePointsQuery, reverseFromPoints, type PaymentTiming, type RatePointsMode } from "@/lib/ratePoints";
import { InlineListError } from "@/components/inline-list-error";
import { listData } from "@/lib/list-response";
import { getQueryErrorStatus } from "@/lib/query-error";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export default function RatePointsPage() {
  const query = parseDealRatePointsQuery(typeof window === "undefined" ? "" : window.location.search);
  const dealId = query.dealId;
  const { data: deal } = useGetDeal(dealId ?? 0, { query: { queryKey: getGetDealQueryKey(dealId ?? 0), enabled: !!dealId } });
  const approvalsQuery = useListDealApprovals(dealId ?? 0, { query: { queryKey: getListDealApprovalsQueryKey(dealId ?? 0), enabled: !!dealId } });
  const approvalList = listData<any>(approvalsQuery.data);
  const latest = latestApproval(approvalList.items);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const save = useSaveDealRatePoints();
  const [advance, setAdvance] = useState("");
  const [payment, setPayment] = useState("");
  const [term, setTerm] = useState("");
  const [timing, setTiming] = useState<PaymentTiming>("arrears");
  const [buyRate, setBuyRate] = useState("18");
  const [mode, setMode] = useState<RatePointsMode>("spread");
  const [targetPoints, setTargetPoints] = useState("");

  useEffect(() => {
    if (latest) {
      setAdvance(String(latest.advance));
      setPayment(String(latest.payment));
      setTerm(String(latest.term));
    } else {
      if (deal?.amount != null) setAdvance(query.advance || String(deal.amount));
      if (query.payment) setPayment(query.payment);
      if (query.term) setTerm(query.term);
    }
  }, [latest?.id, deal?.amount, query.advance, query.payment, query.term]);

  const values = {
    advance: Number(advance),
    payment: Number(payment),
    term: Number(term),
    timing,
    buyNominalRate: Number(buyRate) / 100,
  };
  const result = useMemo(() => {
    if (mode === "reverse") {
      return reverseFromPoints({ advance: values.advance, term: values.term, timing, buyNominalRate: values.buyNominalRate, targetPoints: Number(targetPoints) });
    }
    return calculateRatePoints(values);
  }, [advance, payment, term, timing, buyRate, mode, targetPoints]);
  const effectivePayment = mode === "reverse" && result ? (result as any).payment : values.payment;

  const saveToDeal = () => {
    if (!dealId || !result) return;
    save.mutate({
      id: dealId,
      data: {
        advance: values.advance,
        payment: effectivePayment,
        term: values.term,
        timing,
        buyNominalRate: values.buyNominalRate,
        mode,
        targetPoints: mode === "reverse" ? Number(targetPoints) : null,
        sourceApprovalId: latest?.id ?? null,
      },
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDealActivityQueryKey(dealId) });
        toast({ title: "Rate & Points saved to deal" });
      },
      onError: (error: any) => toast({ title: "Could not save calculation", description: error?.data?.error ?? error?.message ?? "Please try again", variant: "destructive" }),
    });
  };

  return (
    <div className="flex-1 bg-[#f8fafc] overflow-y-auto">
      <div className="max-w-[1200px] mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          {dealId ? <Link href={`/deals/${dealId}`}><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link> : null}
          <div><h1 className="text-2xl font-bold text-[#0E2A47]">Rate &amp; Points</h1><p className="text-sm text-muted-foreground">{deal ? `Calculating for ${deal.dealName}` : "Model a payment stream and commission"}</p></div>
        </div>
        {(approvalsQuery.isError || approvalList.malformed) && <InlineListError title="Couldn’t load calculator prefill" status={approvalsQuery.isError ? getQueryErrorStatus(approvalsQuery.error) : 200} detail={approvalList.malformed ? "The server returned an unexpected approvals response." : undefined} onRetry={() => void approvalsQuery.refetch()} />}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5 text-primary" />Payment inputs</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><Label>Advance</Label><Input type="number" step="0.01" value={advance} onChange={(e) => setAdvance(e.target.value)} /></div>
            <div><Label>Payment</Label><Input type="number" step="0.01" value={payment} onChange={(e) => setPayment(e.target.value)} disabled={mode === "reverse"} /></div>
            <div><Label>Term (payments)</Label><Input type="number" min="1" value={term} onChange={(e) => setTerm(e.target.value)} /></div>
            <div><Label>Payment timing</Label><Select value={timing} onValueChange={(v) => setTiming(v as PaymentTiming)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="arrears">Arrears (first payment after one month)</SelectItem><SelectItem value="advance">One payment in advance</SelectItem></SelectContent></Select></div>
            <div><Label>Buy nominal rate (%)</Label><Input type="number" step="0.01" value={buyRate} onChange={(e) => setBuyRate(e.target.value)} /></div>
            <div><Label>Commission mode</Label><Select value={mode} onValueChange={(v) => setMode(v as RatePointsMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="spread">Live buy-rate spread</SelectItem><SelectItem value="reverse">Target points</SelectItem></SelectContent></Select></div>
            {mode === "reverse" ? <div><Label>Target points (%)</Label><Input type="number" step="0.1" value={targetPoints} onChange={(e) => setTargetPoints(e.target.value)} /></div> : null}
          </CardContent>
        </Card>
        {result ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Sell nominal rate" value={percent(result.nominalRate)} />
              <Stat label="Live spread" value={percent(result.nominalRate - values.buyNominalRate)} />
              <Stat label="Effective rate" value={percent(result.effectiveRate)} />
              <Stat label="Simple rate" value={percent(result.simpleRate)} />
              <Stat label={mode === "reverse" ? "Required payment" : "Payment"} value={money(effectivePayment)} />
              <Stat label="Buy payment" value={money(result.buyPayment)} />
              <Stat label="Total commission" value={money(result.totalCommission)} highlight />
              <Stat label="Commission points" value={`${result.points.toFixed(1)} pts`} highlight />
              {mode === "reverse" ? <Stat label="Target points" value={`${Number(targetPoints).toFixed(1)} pts`} /> : null}
            </div>
            <Card><CardHeader><CardTitle>Payment schedule</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="p-2">#</th><th className="p-2">Opening</th><th className="p-2">Payment</th><th className="p-2">Interest</th><th className="p-2">Principal</th><th className="p-2">Closing</th></tr></thead><tbody>{result.schedule.map((row) => <tr className="border-b last:border-0" key={row.period}><td className="p-2">{row.period}</td><td className="p-2">{money(row.openingBalance)}</td><td className="p-2">{money(row.payment)}</td><td className="p-2">{money(row.interest)}</td><td className="p-2">{money(row.principal)}</td><td className="p-2">{money(row.closingBalance)}</td></tr>)}</tbody></table></CardContent></Card>
            {dealId ? <Button onClick={saveToDeal} disabled={save.isPending}><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save to deal"}</Button> : <p className="text-sm text-muted-foreground">Open this calculator from a deal to save the calculation.</p>}
          </>
        ) : <Card><CardContent className="p-8 text-center text-muted-foreground">Enter a valid advance, payment, term, and buy rate to calculate.</CardContent></Card>}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className={`rounded-xl border p-4 ${highlight ? "border-primary/30 bg-primary/5" : "bg-white"}`}><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-xl font-bold text-[#0E2A47]">{value}</div></div>;
}