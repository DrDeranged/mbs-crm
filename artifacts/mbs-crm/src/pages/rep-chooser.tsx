import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { BrandLogo } from "@/components/brand-logo";

export default function RepChooser() {
  const [, params] = useRoute("/r/:slug");
  const slug = params?.slug || "";
  const [rep, setRep] = useState<{ name: string | null; phone: string | null }>({ name: null, phone: null });
  useEffect(() => {
    fetch(`/api/public/reps/${encodeURIComponent(slug)}`).then((r) => r.json()).then(setRep).catch(() => {});
  }, [slug]);
  const label = rep.name ? `You're applying with ${rep.name}` : "Apply with My Business Solutions";
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-5">
      <section className="w-full max-w-md rounded-2xl bg-white shadow-lg p-7 text-center space-y-6">
        <BrandLogo variant="raw" className="mx-auto" imageClassName="h-10" />
        <div><h1 className="text-2xl font-bold text-[#0E2A47]">{label}</h1>
          {rep.phone && <p className="mt-2 text-gray-500">{rep.phone}</p>}</div>
        <div className="grid gap-3">
          <Link href={`/apply?type=equipment${rep.name ? `&rep=${encodeURIComponent(slug)}` : ""}`} className="rounded-xl bg-[#0E2A47] py-4 text-lg font-semibold text-white">Equipment Financing</Link>
          <Link href={`/apply?type=working_capital${rep.name ? `&rep=${encodeURIComponent(slug)}` : ""}`} className="rounded-xl bg-[#17A567] py-4 text-lg font-semibold text-white">Working Capital</Link>
        </div>
      </section>
    </main>
  );
}