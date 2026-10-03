import { Skeleton } from "@/components/ui/skeleton";

export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3" aria-hidden="true">{Array.from({ length: rows }, (_, i) =>
    <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-10 w-10 shrink-0" />
      <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" /></div>
      <Skeleton className="h-8 w-20" />
    </div>)}</div>;
}

export function ChartSkeleton() {
  return <div className="flex h-56 items-end gap-4 border-b border-border px-6 pb-4" aria-hidden="true">
    {[40,70,55,85,60,95].map((height,i) => <Skeleton key={i} className="flex-1 rounded-t" style={{ height: `${height}%` }} />)}
  </div>;
}

export function PipelineSkeleton() {
  return <div className="flex h-full gap-4 overflow-hidden p-4 md:p-6" role="status" aria-label="Loading deals" data-testid="loading-pipeline">
    {Array.from({length:9}, (_,i) => <div key={i} className="w-72 shrink-0 space-y-3 rounded-xl border border-border bg-muted p-3" aria-hidden="true">
      <div className="flex justify-between"><Skeleton className="h-5 w-36" /><Skeleton className="h-5 w-7" /></div>
      {[0,1].map(j => <div key={j} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-3/5" />
        <div className="flex justify-between"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-12" /></div>
        <Skeleton className="h-3 w-2/3" />
      </div>)}
    </div>)}
  </div>;
}

export function LeadDetailSkeleton() {
  return <div className="space-y-6 p-4 md:p-6" role="status" aria-label="Loading lead" data-testid="loading-lead-detail">
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-5 w-32" /><Skeleton className="h-8 w-3/4" />
      <div className="flex flex-wrap gap-4"><Skeleton className="h-5 w-28" /><Skeleton className="h-5 w-36" /><Skeleton className="h-5 w-44" /></div>
      <div className="flex gap-3"><Skeleton className="h-11 w-44" /><Skeleton className="h-11 w-36" /></div>
    </div>
    <div className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2" aria-hidden="true">
      {Array.from({length:4},(_,i) => <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className="h-5 w-32" /></div>)}
    </div>
    <div className="flex gap-3 overflow-hidden" aria-hidden="true">{Array.from({length:8},(_,i) => <Skeleton key={i} className="h-11 w-20 shrink-0" />)}</div>
    <RowsSkeleton />
  </div>;
}

export function CampaignSkeleton() {
  return <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading campaigns" data-testid="loading-campaigns">
    {Array.from({length:6},(_,i) => <div key={i} className="space-y-5 rounded-xl border border-border bg-card p-6" aria-hidden="true">
      <div className="flex justify-between"><Skeleton className="h-6 w-3/5" /><Skeleton className="h-6 w-16 rounded-full" /></div>
      <Skeleton className="h-4 w-4/5" />
      <div className="grid grid-cols-3 gap-3">{[0,1,2].map(j => <div key={j} className="space-y-2"><Skeleton className="h-7 w-12" /><Skeleton className="h-3 w-16" /></div>)}</div>
      <div className="flex justify-between border-t border-border pt-4"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-24" /></div>
    </div>)}
  </div>;
}

export function DocumentsSkeleton() {
  return <div className="grid gap-4" role="status" aria-label="Loading documents" data-testid="loading-documents">
    {Array.from({length:4},(_,i) => <div key={i} className="flex gap-4 rounded-xl border border-border bg-card p-4" aria-hidden="true">
      <Skeleton className="h-14 w-12 shrink-0" /><div className="flex-1 space-y-3">
        <Skeleton className="h-5 w-2/3" /><Skeleton className="h-3 w-4/5" />
        <div className="flex gap-2"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-24 rounded-full" /></div>
      </div>
    </div>)}
  </div>;
}

export function DashboardSkeleton() {
  return <div className="space-y-6 px-4 py-6 md:px-8" role="status" aria-label="Loading dashboard" data-testid="loading-dashboard">
    <div className="space-y-3" aria-hidden="true"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-64" /></div>
    <div className="space-y-4 rounded-xl border border-border bg-card p-6" aria-hidden="true"><Skeleton className="h-6 w-48" /><Skeleton className="h-24 w-full" /></div>
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden="true">
      {Array.from({length:4},(_,i) => <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-5"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-20" /></div>)}
    </div>
    <ChartSkeleton /><RowsSkeleton />
  </div>;
}