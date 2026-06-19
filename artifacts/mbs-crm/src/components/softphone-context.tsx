import { createContext, useState, useCallback, ReactNode } from "react";

interface SoftphoneContextValue {
  pendingNumber: string | undefined;
  dial: (number: string) => void;
  clearPending: () => void;
}

export const SoftphoneContext = createContext<SoftphoneContextValue>({
  pendingNumber: undefined,
  dial: () => {},
  clearPending: () => {},
});

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [pendingNumber, setPendingNumber] = useState<string | undefined>(undefined);

  const dial = useCallback((number: string) => {
    setPendingNumber(number);
  }, []);

  const clearPending = useCallback(() => {
    setPendingNumber(undefined);
  }, []);

  return (
    <SoftphoneContext.Provider value={{ pendingNumber, dial, clearPending }}>
      {children}
    </SoftphoneContext.Provider>
  );
}
