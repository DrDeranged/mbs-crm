import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type InlineListErrorProps = {
  title: string;
  status?: number | string;
  detail?: string;
  onRetry: () => void;
};

export function InlineListError({ title, status, detail, onRetry }: InlineListErrorProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
      <div className="flex min-w-0 items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">
            {status !== undefined ? `Status ${status}. ` : ""}
            {detail ?? "Please try again."}
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>
    </div>
  );
}