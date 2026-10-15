import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, MailX, MailCheck } from "lucide-react";
import { OPT_OUT_REASON_MAX, validateOptOutReason } from "@/lib/complianceControls";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Preselected action; null forces an explicit choice. */
  initialAction?: boolean | null;
  pending: boolean;
  onConfirm: (input: { isUnsubscribed: boolean; reason: string }) => void;
};

export function EmailOptOutDialog({ open, onOpenChange, count, initialAction = null, pending, onConfirm }: Props) {
  const [action, setAction] = useState<boolean | null>(initialAction);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (open) { setAction(initialAction); setReason(""); setTouched(false); } }, [open, initialAction]);
  const error = validateOptOutReason(reason);
  const target = count === 1 ? "this lead" : `${count} leads`;

  const option = (value: boolean, label: string, hint: string, Icon: React.ElementType) => (
    <button
      type="button"
      data-testid={`button-opt-out-${value ? "set" : "clear"}`}
      onClick={() => setAction(value)}
      aria-pressed={action === value}
      className={cn(
        "flex flex-1 items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors",
        action === value ? (value ? "border-danger bg-danger-bg" : "border-success bg-success-bg") : "hover:bg-muted",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", value ? "text-danger" : "text-success")} />
      <span><span className="block font-medium">{label}</span><span className="text-xs text-muted-foreground">{hint}</span></span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Email opt-out for {target}</DialogTitle>
          <DialogDescription>This sets the existing shared opt-out flag used by email unsubscribe links. Every change is audited. Clearing applies to this record only: other records with the same email address that are opted out may still suppress sending.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 sm:flex-row">
          {option(true, "Set opt-out", "Block automated and campaign email", MailX)}
          {option(false, "Clear opt-out", "Allow email again (confirm consent first)", MailCheck)}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="opt-out-reason">Reason (required)</Label>
          <Textarea
            id="opt-out-reason"
            data-testid="input-opt-out-reason"
            value={reason}
            maxLength={OPT_OUT_REASON_MAX + 50}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="e.g. Customer asked by phone on 3/14 to stop marketing email"
            rows={3}
          />
          <div className="flex justify-between text-xs">
            <span className="text-danger">{touched && error ? error : ""}</span>
            <span className="text-muted-foreground">{reason.trim().length}/{OPT_OUT_REASON_MAX}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button
            data-testid="button-opt-out-confirm"
            disabled={pending || action === null || !!error}
            variant={action ? "destructive" : "default"}
            onClick={() => action !== null && !error && onConfirm({ isUnsubscribed: action, reason: reason.trim() })}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {action === null ? "Choose an action" : action ? `Set opt-out for ${target}` : `Clear opt-out for ${target}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
