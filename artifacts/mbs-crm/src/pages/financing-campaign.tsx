import { AlertTriangle, CheckCircle2, Download, Image, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiBaseUrl } from "@/lib/apiBase";

const api = getApiBaseUrl();
const smsTemplates = [
  ["Working Capital — Needs", "Hi Jane, Nate with My Business Solutions. Need capital for inventory, payroll, or an upcoming job? What amount are you considering? Let's see whether financing fits. Reply STOP to opt out."],
  ["Equipment Financing — Before Purchase", "Hi Jane, Nate with My Business Solutions. Before you pay cash for your next equipment purchase, want to review financing options? Reply with the equipment type and I'll help with the next step. Reply STOP to opt out."],
  ["Financing — Prior Interest Follow-Up", "Hi Jane, Nate with My Business Solutions. You previously asked about financing. Is that still on your list, or has the timing changed? Reply STOP to opt out."],
  ["Working Capital — $10K–$5MM", "Working capital $10k-$5MM, funded in as little as 24 hrs on bank statements alone. Doesn't touch your equipment line. -Nate, MBS 602.245.5425. STOP to opt out."],
] as const;

const safeguards = [
  "No recipient list is selected or imported",
  "No schedule or launch action is configured",
  "Email suppression and unsubscribe checks remain enforced",
  "SMS consent, STOP opt-out, and USFA consent checks remain enforced",
  "Email sender remains My Business Solutions; replies route to the valid assigned rep",
  "Email legal address, unsubscribe footer, tracking, and daily marketing limit remain enforced",
];

export default function FinancingCampaign() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tomorrow’s Financing Campaign</h1>
          <p className="text-muted-foreground">Review-ready content only. This draft cannot select recipients, schedule, or send.</p>
        </div>
        <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Draft · approval required</Badge>
      </div>

      <Card className="border-amber-300 bg-amber-50/70">
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Launch approvals still required</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>Approve the $10K–$5MM range, “as little as 24 hours,” and “bank statements alone” claims.</p>
          <p>Approve eligible equipment/soft-cost language and confirm the intended audience has valid channel consent.</p>
          <p>Select and review recipients, exclusions, and suppression results.</p>
          <p>Approve final sender, launch date/time, and controlled first batch. None are configured here.</p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Mail className="h-4 w-4" />Reusable email templates</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><strong>Equipment Financing — Review Before You Buy</strong><p className="text-muted-foreground">“Most equipment deals don’t die on price” copy, range/documentation claims, equipment and soft costs, working-capital option, qualifying question, Nate Ford signature, and disclaimer.</p></div>
            <div><strong>Working Capital — Preserve Your Bank Line</strong><p className="text-muted-foreground">Bank-line, unsecured-capital, use-of-funds, underwriting, reply request, Nate Ford contact details, and disclaimer.</p></div>
            <p className="rounded-md bg-slate-50 p-2 text-xs">Preview uses <code>{"{{lead_first_name}}"}</code> and displays “Jane” when no lead is selected. The legal footer is appended only during delivery.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Safeguards unchanged</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {safeguards.map((item) => <p key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />{item}</p>)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="h-4 w-4" />SMS test renders</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {smsTemplates.map(([name, body]) => (
            <div key={name} className="rounded-lg border p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>
              <p className="text-sm">{body}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Image className="h-4 w-4" />Reusable collateral</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {[
            ["Working Capital — Take on the Job", `${api}/collateral/campaign-assets/working-capital`],
            ["Equipment Financing — The Next Piece of Your Business", `${api}/collateral/campaign-assets/equipment-financing`],
          ].map(([title, src]) => (
            <figure key={title} className="overflow-hidden rounded-lg border bg-white">
              <img src={src} alt={title} className="aspect-[2/3] w-full object-contain" />
              <figcaption className="flex items-center justify-between gap-3 border-t p-3 text-sm font-medium">
                <span>{title}</span>
                <a href={`${src}/download`} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#1F4E79] hover:underline">
                  <Download className="h-3.5 w-3.5" />Original PNG
                </a>
              </figcaption>
            </figure>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}