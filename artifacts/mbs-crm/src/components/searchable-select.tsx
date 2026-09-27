import { useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { filterSearchableOptions, type SearchableOption } from "@/lib/searchable-select-options";

type Props = {
  options: SearchableOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
};

export function SearchableSelectOptionList({
  options, query, value, onSelect, emptyText = "No matches found.",
}: {
  options: SearchableOption[];
  query: string;
  value: string;
  onSelect: (value: string) => void;
  emptyText?: string;
}) {
  const visible = filterSearchableOptions(options, query);
  return (
    <CommandList className="max-h-[300px] overflow-y-auto overscroll-contain" data-testid="searchable-select-list">
      <CommandEmpty>{emptyText}</CommandEmpty>
      {visible.map((option) => (
        <CommandItem
          key={option.value}
          value={option.value || `empty-${option.label}`}
          disabled={option.disabled}
          onSelect={() => { if (!option.disabled) onSelect(option.value); }}
        >
          <Check className={cn("h-4 w-4 shrink-0", value === option.value ? "opacity-100" : "opacity-0")} />
          <span className="min-w-0 truncate">{option.label}</span>
          {option.detail && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{option.detail}</span>}
        </CommandItem>
      ))}
    </CommandList>
  );
}

export function SearchableSelect({
  options, value, onValueChange, placeholder, searchPlaceholder = "Search by name…",
  emptyText, ariaLabel, disabled, className, testId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel || placeholder}
          disabled={disabled}
          data-testid={testId}
          className={cn("h-9 w-full min-w-0 justify-between gap-2 px-3 font-normal", className)}
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        className="z-[var(--z-dialog-popover)] w-[var(--radix-popover-trigger-width)] min-w-[14rem] border-border bg-popover p-0 text-popover-foreground shadow-md backdrop-blur-none"
      >
        <Command shouldFilter={false}>
          <CommandInput ref={inputRef} value={query} onValueChange={setQuery}
            placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
          <SearchableSelectOptionList
            options={options}
            query={query}
            value={value}
            emptyText={emptyText}
            onSelect={(next) => { onValueChange(next); handleOpenChange(false); }}
          />
        </Command>
      </PopoverContent>
    </Popover>
  );
}