import { useEffect, useState } from "react";
import { sanitizeEmailHtml } from "@/lib/sanitizeEmailHtml";

type SanitizedPreview =
  | { source: string; html: string }
  | { source: string; error: true }
  | null;

export function SafeEmailHtmlPreview({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const [preview, setPreview] = useState<SanitizedPreview>(null);
  const isCurrent = preview?.source === html;

  useEffect(() => {
    let active = true;
    void sanitizeEmailHtml(html).then(
      (sanitizedHtml) => {
        if (active) setPreview({ source: html, html: sanitizedHtml });
      },
      () => {
        if (active) setPreview({ source: html, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [html]);

  return (
    <div className={className} aria-busy={!isCurrent}>
      {!isCurrent ? (
        <p className="text-xs text-muted-foreground" role="status">Preparing safe preview…</p>
      ) : preview && "error" in preview ? (
        <p className="text-xs text-destructive" role="status">Email preview is unavailable because the content could not be sanitized.</p>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }} />
      )}
    </div>
  );
}