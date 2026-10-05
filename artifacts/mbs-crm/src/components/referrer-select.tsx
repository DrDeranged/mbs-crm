import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useListReferralOptions, type ReferrerOption } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = { value: { type: "lead" | "partner"; id: number; label?: string } | null; onChange: (v: ReferrerOption | null) => void; excludeLeadId?: number; disabled?: boolean };

export function ReferrerSelect({ value, onChange, excludeLeadId, disabled }: Props) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const t = setTimeout(() => setTerm(text.trim()), 250); return () => clearTimeout(t); }, [text]);
  const q = useListReferralOptions({ search: term }, { query: { enabled: term.length >= 2 && !value } as any });
  const options = (q.data ?? []).filter((o) => !(o.type === "lead" && o.id === excludeLeadId));
  if (value) {
    return (
      <div className="flex items-center gap-2" data-testid="referrer-selected">
        <Badge variant="secondary" className="capitalize">{value.type}</Badge>
        <span className="text-sm">{value.label ?? `#${value.id}`}</span>
        {!disabled && <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Clear referred by" onClick={() => onChange(null)} data-testid="button-clear-referrer"><X className="h-4 w-4" /></Button>}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search leads or partners (2+ letters)" aria-label="Search referrer" disabled={disabled} data-testid="input-referrer-search" />
      {term.length >= 2 && (
        <ul role="listbox" aria-label="Referrer results" className="max-h-48 overflow-auto rounded-md border bg-card text-sm">
          {q.isLoading && <li className="p-2 text-muted-foreground">Searching…</li>}
          {q.isError && <li className="p-2 text-danger">Search failed. <button type="button" className="underline" onClick={() => q.refetch()}>Retry</button></li>}
          {!q.isLoading && !q.isError && options.length === 0 && <li className="p-2 text-muted-foreground">No matches.</li>}
          {options.map((o) => (
            <li key={`${o.type}:${o.id}`} role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => { onChange(o); setText(""); }} data-testid={`option-referrer-${o.type}-${o.id}`}>
                <Badge variant="secondary" className="capitalize">{o.type}</Badge>{o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
