const MAX_FILENAME_LENGTH = 180;

export function safeDownloadFilename(value: string, fallback: string): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  const safe = basename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+/, "")
    .slice(0, MAX_FILENAME_LENGTH);
  return safe || fallback;
}

export async function fetchAuthenticatedBlob(url: string): Promise<Blob> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/pdf,image/*,application/octet-stream" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("The downloaded file was empty");
  return blob;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
