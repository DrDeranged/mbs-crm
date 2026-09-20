function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function documentContentDisposition(filename: string, documentId: number): string {
  const extension = filename.match(/(\.[A-Za-z0-9]{1,10})$/)?.[1] ?? "";
  const fallback = `document-${documentId}${extension}`;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}