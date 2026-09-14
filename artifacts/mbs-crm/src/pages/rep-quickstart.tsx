import { Link } from "wouter";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Info,
  Mail,
  PhoneCall,
  Sparkles,
  Users,
} from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Your leads",
    icon: Users,
    accent: "bg-[#E4F8EF] text-[#128955]",
    children: (
      <>
        <p>
          Start in <Link className="font-semibold text-[#128955] hover:underline" href="/leads">Leads</Link> to see your pipeline, or add a lead when a new conversation starts.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[#17A567]">
          <li>Open a lead to review contact details, status, score, documents, and applications.</li>
          <li>Keep the status current so your next move and the pipeline stay clear.</li>
        </ul>
        <Link
          href="/leads"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#128955] transition-colors hover:text-[#0E2A47]"
        >
          Open your leads <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </>
    ),
  },
  {
    number: "02",
    title: "Logging activity & tasks",
    icon: ClipboardCheck,
    accent: "bg-[#EAF1FF] text-[#3569A8]",
    children: (
      <>
        <p>Leave every lead with a clear record of what happened and what comes next.</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[#17A567]">
          <li>Use <strong>Notes</strong> for conversation context and important deal details.</li>
          <li>Use <strong>Tasks</strong> to create a follow-up with an optional due date, then check it off when complete.</li>
          <li>Review <strong>Activity</strong> for the timeline of updates, documents, and outreach.</li>
        </ul>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#DCE4EC] bg-[#F8FBFD] px-3 py-2.5 text-xs leading-5 text-[#46586C]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#17A567]" />
          <span>Good habit: add the next task before you leave a lead.</span>
        </div>
      </>
    ),
  },
  {
    number: "03",
    title: "Running a lender match",
    icon: Building2,
    accent: "bg-[#FFF4DF] text-[#B26B0E]",
    children: (
      <>
        <p>Use the Lenders tab to compare the best-fit options for a lead.</p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 marker:font-semibold marker:text-[#B26B0E]">
          <li><span>Open the lead and confirm the application and financial details are up to date.</span></li>
          <li><span>Choose <strong>Run Match</strong> in the Lenders tab.</span></li>
          <li><span>Review match scores and criteria, then follow your team&apos;s process before submitting.</span></li>
        </ol>
        <p className="mt-4 text-xs leading-5 text-[#46586C]">
          A match is a recommendation, not a submission. Confirm the deal details and lender fit first.
        </p>
      </>
    ),
  },
  {
    number: "04",
    title: "Templates & drips",
    icon: Mail,
    accent: "bg-[#F1EAFF] text-[#7650B5]",
    children: (
      <>
        <p>Use approved email templates and drip sequences to keep follow-up consistent.</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[#7650B5]">
          <li>Browse <Link className="font-semibold text-[#7650B5] hover:underline" href="/email/templates">Email Templates</Link> when you need a repeatable message.</li>
          <li>Review <Link className="font-semibold text-[#7650B5] hover:underline" href="/drip/sequences">Drip Sequences</Link> for structured follow-up.</li>
          <li>Personalize the message and check the lead details before anything goes out.</li>
        </ul>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#E5D9FF] bg-[#FBF9FF] px-3 py-2.5 text-xs leading-5 text-[#5E4A84]">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7650B5]" />
          <span><strong>Note:</strong> sending activates soon. For now, use templates and drips as your preparation workspace.</span>
        </div>
      </>
    ),
  },
  {
    number: "05",
    title: "Calling from a lead",
    icon: PhoneCall,
    accent: "bg-[#E4F8EF] text-[#128955]",
    children: (
      <>
        <p>Open a lead and select the <strong>Comms</strong> tab to keep outreach close to the record.</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-[#17A567]">
          <li>Use the <strong>Call</strong> button beside the lead&apos;s phone number to open the browser softphone.</li>
          <li>When the call is finished, capture the outcome and notes so the team has the full context.</li>
          <li>Create a follow-up task if the lead needs a next touch.</li>
        </ul>
        <p className="mt-4 text-xs leading-5 text-[#46586C]">
          No phone number? Ask for one in your next interaction and add it to the lead details.
        </p>
      </>
    ),
  },
];

export default function RepQuickstart() {
  return (
    <div className="min-h-full bg-[#F4F8FA]">
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <header className="relative overflow-hidden rounded-[26px] bg-[#0E2A47] px-6 py-8 text-white shadow-[0_24px_60px_rgba(14,42,71,.2)] sm:px-10 sm:py-10 lg:px-14 lg:py-12">
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border-[34px] border-[#17A567]/15" />
          <div className="pointer-events-none absolute -bottom-24 right-24 h-48 w-48 rounded-full bg-[#17A567]/10 blur-2xl" />
          <div className="relative max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#6EE7C0]/25 bg-[#6EE7C0]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8AE6C1]">
              <Sparkles className="h-3.5 w-3.5" />
              Rep quickstart
            </div>
            <h1 className="max-w-xl text-3xl font-bold leading-tight tracking-[-0.03em] text-white sm:text-4xl lg:text-[2.75rem]">
              A clear path from lead to funding.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/70 sm:text-base">
              The essentials for moving confidently through MBS CRM. Keep every conversation documented, every next step visible, and every lead moving.
            </p>
          </div>
        </header>

        <div className="mt-6 space-y-4 sm:mt-8 sm:space-y-5">
          {steps.map(({ number, title, icon: Icon, accent, children }) => (
            <section
              key={title}
              aria-labelledby={`quickstart-${number}`}
              className="rounded-[22px] border border-[#DCE4EC] bg-white p-5 shadow-[0_8px_26px_rgba(14,42,71,.05)] sm:p-7"
            >
              <div className="flex items-start gap-4 sm:gap-5">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${accent}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[10px] font-bold tracking-[0.18em] text-[#8B9AA8]">{number}</span>
                    <h2 id={`quickstart-${number}`} className="text-lg font-bold tracking-tight text-[#0E2A47] sm:text-xl">
                      {title}
                    </h2>
                  </div>
                  <div className="mt-3 max-w-3xl text-sm leading-6 text-[#46586C] [&_strong]:font-semibold [&_strong]:text-[#0E2A47]">
                    {children}
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-7 flex items-center gap-2 text-xs text-[#8B9AA8] sm:mt-8">
          <span className="h-1.5 w-1.5 rounded-full bg-[#17A567]" />
          Keep it simple: update the lead, log the next step, and follow through.
        </div>
      </div>
    </div>
  );
}