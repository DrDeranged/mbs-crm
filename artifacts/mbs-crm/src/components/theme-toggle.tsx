import { useEffect, useId } from "react";
import { Moon, Sun } from "lucide-react";
import { useAppearance } from "@/components/appearance-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

export function ThemeToggle() {
  const { mode, setPreference, storageError } = useAppearance();
  const { toast } = useToast();
  const errorId = useId();
  const nextMode = mode === "dark" ? "light" : "dark";
  const label = `Switch to ${nextMode} mode`;
  const Icon = mode === "dark" ? Sun : Moon;

  useEffect(() => {
    if (storageError) {
      toast({ title: "Theme changed for this session", description: storageError, variant: "destructive" });
    }
  }, [storageError, toast]);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-describedby={storageError ? errorId : undefined}
            onClick={() => setPreference(nextMode)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            data-testid="header-theme-toggle"
          >
            <Icon size={18} aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {label}
          {storageError && <p className="mt-1 max-w-64">{storageError}</p>}
        </TooltipContent>
      </Tooltip>
      {storageError && <span id={errorId} role="status" className="sr-only">{storageError}</span>}
    </>
  );
}