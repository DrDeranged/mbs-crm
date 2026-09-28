export interface UsfaConnectionSettings {
  usfaSheetId: string | null;
  usfaSheetTab: string;
}

export function usfaConnectionInputValues(settings: UsfaConnectionSettings): {
  sheetId: string;
  sheetTab: string;
} {
  return {
    sheetId: settings.usfaSheetId ?? "",
    sheetTab: settings.usfaSheetTab || "Sheet1",
  };
}

export function usfaConnectionLoadStatus(status: number | null): string {
  return status === null
    ? "HTTP status unavailable (network error)"
    : `HTTP ${status}`;
}