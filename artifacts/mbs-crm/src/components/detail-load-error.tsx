import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getQueryErrorReason } from "@/lib/query-error";

type DetailLoadErrorProps = {
  entity: "lead" | "deal";
  error: unknown;
  isAdmin: boolean;
  onRetry: () => void;
};

export function DetailLoadError({
  entity,
  error,
  isAdmin,
  onRetry,
}: DetailLoadErrorProps) {
  const reason = isAdmin ? getQueryErrorReason(error) : null;

  return (
    <div
      className="flex flex-1 min-h-[360px] items-center justify-center p-8"
      role="alert"
    >
      <div className="max-w-md space-y-4 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">
            {`Couldn't load this ${entity}`}
          </h2>
          {reason && (
            <p className="text-sm text-muted-foreground">
              API error: {reason}
            </p>
          )}
        </div>
        <Button type="button" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}