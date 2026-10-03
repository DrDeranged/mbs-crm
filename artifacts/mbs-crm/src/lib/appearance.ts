export type AppearancePreference = "system" | "light" | "dark";

export function appearanceKey(userId: string): string {
  return `mbs-web-appearance:${userId}`;
}

export function readAppearance(storage: Pick<Storage, "getItem">, userId: string | null): AppearancePreference {
  if (!userId) return "system";
  try {
    const saved = storage.getItem(appearanceKey(userId));
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    // Private browsing/storage policy may make preferences unavailable.
    return "system";
  }
}

export function resolveAppearance(preference: AppearancePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function readBrowserAppearance(userId: string | null): AppearancePreference {
  try { return readAppearance(window.localStorage, userId); } catch { return "system"; }
}