import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/react";
import { appearanceKey, readBrowserAppearance, resolveAppearance, type AppearancePreference } from "@/lib/appearance";

interface AppearanceContextValue {
  preference: AppearancePreference;
  mode: "light" | "dark";
  setPreference: (preference: AppearancePreference) => void;
  storageError: string | null;
}
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const userId = isLoaded && isSignedIn ? user?.id ?? null : null;
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [choice, setChoice] = useState<{ owner: string | null; preference: AppearancePreference }>({ owner: null, preference: "light" });
  const [storageError, setStorageError] = useState<string | null>(null);
  // Resolve a new owner synchronously. Never render the previous account's
  // preference while waiting for an effect after sign-out/account switching.
  const preference = choice.owner === userId ? choice.preference : readBrowserAppearance(userId);
  const mode = resolveAppearance(preference, systemDark);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
    document.documentElement.dataset.appearance = mode;
  }, [mode]);
  useEffect(() => {
    setChoice({ owner: userId, preference: readBrowserAppearance(userId) });
    setStorageError(null);
  }, [userId]);
  useEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const updateScheme = () => setSystemDark(scheme.matches);
    const updateStorage = (event: StorageEvent) => {
      if (userId && event.key === appearanceKey(userId)) setChoice({ owner: userId, preference: readBrowserAppearance(userId) });
    };
    scheme.addEventListener("change", updateScheme);
    window.addEventListener("storage", updateStorage);
    return () => {
      scheme.removeEventListener("change", updateScheme);
      window.removeEventListener("storage", updateStorage);
    };
  }, [userId]);
  const value = useMemo<AppearanceContextValue>(() => ({
    preference, mode, storageError,
    setPreference(next) {
      if (!userId) return;
      setChoice({ owner: userId, preference: next });
      try {
        window.localStorage.setItem(appearanceKey(userId), next);
        setStorageError(null);
      } catch {
        setStorageError("Your browser blocked saving this appearance preference. It applies until you reload.");
      }
    },
  }), [preference, mode, userId, storageError]);
  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error("AppearanceProvider is required.");
  return appearance;
}

export function useOptionalAppearance() {
  return useContext(AppearanceContext);
}