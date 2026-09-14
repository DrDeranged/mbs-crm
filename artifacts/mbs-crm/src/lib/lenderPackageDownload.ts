const PDF_EXTENSION = ".pdf";
const MAX_FILENAME_LENGTH = 180;

function decodeFilename(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fallbackFilename(value: string): string {
  const fallback = value.trim() || "MBS-Lender-Package.pdf";
  return sanitizeFilename(fallback, "MBS-Lender-Package.pdf");
}

function sanitizeFilename(value: string, fallback: string): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  let safe = basename
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^\.+/, "");

  if (!safe) return fallback;
  if (!safe.toLowerCase().endsWith(PDF_EXTENSION)) safe += PDF_EXTENSION;

  if (safe.length > MAX_FILENAME_LENGTH) {
    safe = `${safe.slice(0, MAX_FILENAME_LENGTH - PDF_EXTENSION.length)}${PDF_EXTENSION}`;
  }

  return safe;
}

/**
 * Gets a safe local download name from a server Content-Disposition header.
 *
 * The server owns the preferred filename, but the header is still untrusted
 * client input. Strip path/control characters before assigning it to an
 * anchor's download attribute.
 */
export function getLenderPackageFilename(
  contentDisposition: string | null,
  fallback = "MBS-Lender-Package.pdf",
): string {
  const encodedFilename = contentDisposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const quotedFilename = contentDisposition?.match(/filename\s*=\s*"([^"]*)"/i)?.[1];
  const unquotedFilename = contentDisposition?.match(/filename\s*=\s*([^;]+)/i)?.[1];
  const headerFilename = encodedFilename
    ? decodeFilename(encodedFilename)
    : quotedFilename ?? unquotedFilename;

  return headerFilename
    ? sanitizeFilename(headerFilename, fallbackFilename(fallback))
    : fallbackFilename(fallback);
}