import { AlertTriangle, MailCheck, Paperclip } from "lucide-react";
import type { CampaignReply } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

export const FORWARD_LABELS: Record<CampaignReply["forwardStatus"], { label: string; tone: string; hint?: string }> = {
  pending: { label: "Forward pending", tone: "bg-secondary text-foreground" },
  dispatching: { label: "Forwarding", tone: "bg-info-bg text-info" },
  forwarded: { label: "Forwarded", tone: "bg-success-bg text-success" },
  failed: { label: "Forward failed", tone: "bg-danger-bg text-danger", hint: "Forwarding failed. Check the reason and reply to the sender directly if needed." },
  uncertain: { label: "Forward uncertain", tone: "bg-warning-bg text-warning", hint: "The provider outcome is unknown. It is held to avoid a duplicate forward and is not retried automatically." },
};

export function CampaignRepliesList({ replies, isLoading, isError, onRetry }: { replies?: CampaignReply[]; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) return <div className="h-16 animate-pulse rounded bg-muted" aria-busy="true" />;
  if (isError) return <div role="alert" className="text-sm text-danger">Couldn't load replies. <button type="button" className="underline" onClick={onRetry}>Retry</button></div>;
  if (!replies || replies.length === 0) return <p className="text-sm text-muted-foreground">No human replies captured yet.</p>;
  return (
    <ul className="space-y-3" data-testid="list-campaign-replies">
      {replies.map((r) => {
        const st = FORWARD_LABELS[r.forwardStatus];
        return (
          <li key={r.id} className="rounded-lg border bg-card p-3 text-sm" data-testid={`reply-${r.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{r.fromEmail}</span>
              <span className="text-xs text-muted-foreground">{new Date(r.receivedAt).toLocaleString()}</span>
            </div>
            <div className="text-muted-foreground">{r.subject || "(no subject)"}</div>
            <Link href={`/leads/${r.leadId}`} className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-2">View lead</Link>
            <p className="mt-2 whitespace-pre-wrap break-words">{r.bodyText}</p>
            {r.attachments.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {r.attachments.map((a, i) => <li key={i} className="flex items-center gap-1"><Paperclip className="h-3 w-3" />{a.filename}</li>)}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className={st.tone}>
                {r.forwardStatus === "forwarded" ? <MailCheck className="mr-1 h-3 w-3" /> : (r.forwardStatus === "failed" || r.forwardStatus === "uncertain") ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}
                {st.label}
              </Badge>
              {st.hint && <span className="text-xs text-muted-foreground" role="note">{st.hint}</span>}
              {r.failureReason && <span className="text-xs text-danger">Reason: {r.failureReason}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
