import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Props = {
  apiBase: string;
  kind: "business" | "after-hours";
  label: string;
  objectPath: string | null;
  onChange: (path: string | null) => void;
};

export function TelephonyGreetingUpload({ apiBase, kind, label, objectPath, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!/\.mp3$/i.test(file.name) || file.type !== "audio/mpeg" || file.size < 1 || file.size > 2 * 1024 * 1024) {
      setError("Choose an MP3 file under 2 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const request = await fetch(`${apiBase}/settings/telephony/greetings/${kind}/upload-url`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: "audio/mpeg" }),
      });
      const grant = await request.json();
      if (!request.ok) throw new Error(grant.error || "Unable to prepare audio upload.");
      const uploaded = await fetch(grant.uploadUrl, {
        method: "PUT", headers: { "Content-Type": "audio/mpeg" }, body: file,
      });
      if (!uploaded.ok) throw new Error("Audio upload failed.");
      const completion = await fetch(`${apiBase}/settings/telephony/greetings/${kind}/complete`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectPath: grant.objectPath, grant: grant.grant }),
      });
      const result = await completion.json();
      if (!completion.ok) throw new Error(result.error || "Unable to verify audio.");
      onChange(result.objectPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audio upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/settings/telephony/greetings/${kind}`, {
        method: "DELETE", credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to remove greeting audio.");
      onChange(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove greeting audio.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={`greeting-audio-${kind}`} className="text-sm font-medium">{label} (optional MP3)</label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`greeting-audio-${kind}`} type="file" accept=".mp3,audio/mpeg" className="max-w-xs"
          disabled={busy} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = "";
          }}
        />
        {objectPath && <Button type="button" variant="outline" disabled={busy} onClick={() => void remove()}>Remove audio</Button>}
      </div>
      <p className="text-xs text-muted-foreground">
        {objectPath ? "Audio greeting active. The written greeting is the fallback." : "Using the written greeting."} Maximum 2 MB.
      </p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}