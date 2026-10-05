import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { BrandLogo } from "@/components/brand-logo";
import { canonicalRepSlug, repChooserApplyHref, repChooserSubtext, type RepChooserData } from "@/lib/repChooser";
import { useGetPublicReferral } from "@workspace/api-client-react";
import { getApiBaseUrl } from "@/lib/apiBase";

export default function RepChooser() {
  const [, params] = useRoute("/r/:slug");
  const slug = params?.slug || "";
  const invite = new URLSearchParams(window.location.search).get("invite");
  const referral = new URLSearchParams(window.location.search).get("referral");
  const referralQ = useGetPublicReferral(referral ?? "", { query: { enabled: !!referral, retry: false } as any });
  const [useReferral, setUseReferral] = useState(true);
  const [rep, setRep] = useState<RepChooserData>({ name: null, phone: null });
  useEffect(() => {
    fetch(`${getApiBaseUrl()}/public/reps/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((data: RepChooserData) => {
        setRep(data);
        // The API deliberately uses a real 301 for old links. fetch follows
        // that redirect, so replace the SPA URL with the canonical slug too.
        // This is client-side only; direct navigation still relies on the web
        // host's SPA fallback to render this chooser route.
        if (data.slug && data.slug !== slug) {
          window.history.replaceState({}, "", `/r/${encodeURIComponent(data.slug)}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`);
        }
      })
      .catch(() => {});
  }, [slug]);
  const label = rep.name ? `You're applying with ${rep.name}` : "Apply with My Business Solutions";
  const canonicalSlug = canonicalRepSlug(rep, slug);
  const subtext = repChooserSubtext(rep);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-info-bg flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl bg-card p-7 text-center space-y-6">
        <BrandLogo className="mx-auto" imageClassName="h-10 w-auto" />
        <div><h1 className="text-2xl font-bold text-foreground">{label}</h1>
          {subtext && <p className="mt-2 text-muted-foreground">{subtext}</p>}
          {rep.phone && <p className="mt-2 text-muted-foreground">{rep.phone}</p>}
          {referral && referralQ.data && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-secondary px-3 py-2 text-sm" data-testid="text-referred-by">
              <span>{useReferral ? `Referred by ${referralQ.data.label}` : "Referral not applied"}</span>
              <button type="button" className="font-medium underline underline-offset-2" aria-pressed={!useReferral} onClick={() => setUseReferral((v) => !v)} data-testid="button-toggle-referral">{useReferral ? "Don't use" : "Use referral"}</button>
            </div>
          )}
          {referral && referralQ.isError && <p className="mt-3 text-sm text-muted-foreground" role="status">This referral link is no longer valid. You can still continue.</p>}</div>
        <div className="grid gap-3">
          <Link href={repChooserApplyHref(rep, slug, basePath, invite) + (referral && referralQ.data && useReferral ? `&referral=${encodeURIComponent(referral)}` : "")} className="block w-full rounded-xl bg-primary py-4 text-lg font-semibold text-primary-foreground">Continue</Link>
        </div>
        {rep.name && <a href={`${getApiBaseUrl()}/public/reps/${encodeURIComponent(canonicalSlug)}/application-form.pdf`} className="text-xs font-medium text-foreground underline underline-offset-2">Prefer a paper application? Download PDF</a>}
        <p className="text-xs text-muted-foreground">
          Questions? Call <a href="tel:+19088608507" className="underline">(908) 860-8507</a> or email{" "}
          <a href="mailto:funding@my-business-solutions.com" className="underline">funding@my-business-solutions.com</a>.
        </p>
      </section>
    </main>
  );
}