import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatQueryErrorStatus } from "@/lib/query-error";

interface QueryErrorStateProps {
  error: unknown;
  onRetry: () => void;
  label: string;
  testId: string;
}

export function QueryErrorState({
  error,
  onRetry,
  label,
  testId,
}: QueryErrorStateProps) {
  return (
    <Alert
      variant="destructive"
      className="flex items-center justify-between gap-4"
      data-testid={testId}
    >
      <div>
        <AlertTitle>{label} could not be loaded</AlertTitle>
        <AlertDescription>{formatQueryErrorStatus(error)}</AlertDescription>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid={`${testId}-retry`}
        className="shrink-0"
      >
        Retry
      </Button>
    </Alert>
  );
}