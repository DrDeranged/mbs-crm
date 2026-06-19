import { createContext, useState, useCallback, ReactNode } from "react";

interface DialOptions {
  autoCall?: boolean;
}

interface SoftphoneContextValue {
  pendingNumber: string | undefined;
  autoCall: boolean;
  dial: (number: string, options?: DialOptions) => void;
  clearPending: () => void;
}

export const SoftphoneContext = createContext<SoftphoneContextValue>({
  pendingNumber: undefined,
  autoCall: false,
  dial: () => {},
  clearPending: () => {},
});

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [pendingNumber, setPendingNumber] = useState<string | undefined>(undefined);
  const [autoCall, setAutoCall] = useState(false);

  const dial = useCallback((number: string, options?: DialOptions) => {
    setPendingNumber(number);
    setAutoCall(options?.autoCall ?? false);
  }, []);

  const clearPending = useCallback(() => {
    setPendingNumber(undefined);
    setAutoCall(false);
  }, []);

  return (
    <SoftphoneContext.Provider value={{ pendingNumber, autoCall, dial, clearPending }}>
      {children}
    </SoftphoneContext.Provider>
  );
}
