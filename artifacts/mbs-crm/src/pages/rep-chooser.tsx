import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { BrandLogo } from "@/components/brand-logo";
import { canonicalRepSlug, repChooserApplyHref, repChooserSubtext, type RepChooserData } from "@/lib/repChooser";
import { getApiBaseUrl } from "@/lib/apiBase";

export default function RepChooser() {
  const [, params] = useRoute("/r/:slug");
  const slug = params?.slug || "";
  const invite = new URLSearchParams(window.location.search).get("invite");
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
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl bg-white shadow-lg p-7 text-center space-y-6">
        <BrandLogo variant="raw" className="mx-auto" imageClassName="h-10" />
        <div><h1 className="text-2xl font-bold text-[#0E2A47]">{label}</h1>
          {subtext && <p className="mt-2 text-gray-500">{subtext}</p>}
          {rep.phone && <p className="mt-2 text-gray-500">{rep.phone}</p>}</div>
        <div className="grid gap-3">
          <Link href={repChooserApplyHref(rep, slug, basePath, invite)} className="block w-full rounded-xl bg-[#17A567] py-4 text-lg font-semibold text-white">Continue</Link>
        </div>
        {rep.name && <a href={`${getApiBaseUrl()}/public/reps/${encodeURIComponent(canonicalSlug)}/application-form.pdf`} className="text-xs font-medium text-[#0E2A47] underline underline-offset-2">Prefer a paper application? Download PDF</a>}
      </section>
    </main>
  );
}