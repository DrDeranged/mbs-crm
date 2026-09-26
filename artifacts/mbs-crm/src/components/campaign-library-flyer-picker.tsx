import { useEffect, useState } from "react";
import { Check, FileText, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FLYER_AUDIENCES, FLYER_CATEGORIES, FLYER_VERTICALS,
  listCampaignLibraryFlyers, normalizeFlyerLabel,
  type CampaignLibraryFlyer, type FlyerFilters,
} from "@/lib/campaignFlyerLibrary";

export type CampaignLibraryFlyerSelection = { source: "library"; templateId: number; name: string };

export function CampaignLibraryFlyerPicker({
  onSelect,
  currentSelection,
  selected,
}: {
  onSelect: (selection: CampaignLibraryFlyerSelection) => void;
  currentSelection?: CampaignLibraryFlyerSelection | null;
  selected?: CampaignLibraryFlyerSelection | null;
}) {
  const [filters, setFilters] = useState<FlyerFilters>({});
  const [search, setSearch] = useState("");
  const [flyers, setFlyers] = useState<CampaignLibraryFlyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [rep, setRep] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    listCampaignLibraryFlyers(filters).then((items) => {
      if (active) setFlyers(items);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not load flyers.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters.category, filters.vertical, filters.audience, filters.repId, attempt]);

  const visible = flyers.filter((flyer) => flyer.name.toLowerCase().includes(search.trim().toLowerCase()));
  const updateFilter = (key: "category" | "vertical" | "audience", value: string) =>
    setFilters((old) => ({ ...old, [key]: value === "all" ? undefined : value }));

  return (
    <div className="space-y-3" data-testid="campaign-library-flyer-picker">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input data-testid="input-library-flyer-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search flyers by name" aria-label="Search flyers by name" />
        <div className="flex gap-2">
          <Input data-testid="input-library-flyer-rep" className="min-w-0" type="number" min="1" value={rep} onChange={(event) => setRep(event.target.value)} placeholder="Rep ID" aria-label="Filter by rep ID" />
          <Button data-testid="button-library-flyer-apply-rep" type="button" variant="outline" onClick={() => setFilters((old) => ({ ...old, repId: rep && Number(rep) > 0 ? Number(rep) : undefined }))}>Apply</Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          ["category", "Category", FLYER_CATEGORIES],
          ["vertical", "Vertical", FLYER_VERTICALS],
          ["audience", "Audience", FLYER_AUDIENCES],
        ] as const).map(([key, title, options]) => (
          <Select key={key} value={filters[key] || "all"} onValueChange={(value) => updateFilter(key, value)}>
            <SelectTrigger data-testid={`select-library-flyer-${key}`} aria-label={`Filter by ${title.toLowerCase()}`}><SelectValue placeholder={title} /></SelectTrigger>
            <SelectContent><SelectItem value="all">All {title.toLowerCase()}s</SelectItem>{options.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
          </Select>
        ))}
      </div>
      {loading ? <div className="space-y-2" aria-label="Loading flyers">{[0, 1, 2].map((index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted" />)}</div>
        : error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p role="alert">{error}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></div>
        : visible.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No flyers match these filters. Try another category, vertical, audience, or rep.</div>
        : <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
          {visible.map((flyer) => {
            const isSelected = (currentSelection ?? selected)?.source === "library" && (currentSelection ?? selected)?.templateId === flyer.templateId;
            return <button
              key={flyer.templateId}
              type="button"
              data-testid={`button-select-library-flyer-${flyer.templateId}`}
              aria-pressed={isSelected}
              onClick={() => onSelect({ source: "library", templateId: flyer.templateId, name: normalizeFlyerLabel(flyer.name) })}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-muted/40 ${isSelected ? "border-primary bg-primary/5" : "bg-card"}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{normalizeFlyerLabel(flyer.name)}</span><span className="mt-1 flex flex-wrap gap-1"><Badge variant="outline">{FLYER_CATEGORIES.find(([key]) => key === flyer.category)?.[1]}</Badge><Badge variant="outline">{FLYER_VERTICALS.find(([key]) => key === flyer.vertical)?.[1]}</Badge><Badge variant="outline">{FLYER_AUDIENCES.find(([key]) => key === flyer.audience)?.[1]}</Badge></span></span>
              {isSelected && <Check className="h-5 w-5 shrink-0 text-primary" />}
            </button>;
          })}
        </div>}
    </div>
  );
}