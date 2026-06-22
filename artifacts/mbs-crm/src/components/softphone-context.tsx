import { createContext, useState, useCallback, ReactNode } from "react";

interface DialOptions {
  autoCall?: boolean;
  leadId?: number;
}

interface SoftphoneContextValue {
  pendingNumber: string | undefined;
  autoCall: boolean;
  pendingLeadId: number | undefined;
  dial: (number: string, options?: DialOptions) => void;
  clearPending: () => void;
}

export const SoftphoneContext = createContext<SoftphoneContextValue>({
  pendingNumber: undefined,
  autoCall: false,
  pendingLeadId: undefined,
  dial: () => {},
  clearPending: () => {},
});

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [pendingNumber, setPendingNumber] = useState<string | undefined>(undefined);
  const [autoCall, setAutoCall] = useState(false);
  const [pendingLeadId, setPendingLeadId] = useState<number | undefined>(undefined);

  const dial = useCallback((number: string, options?: DialOptions) => {
    setPendingNumber(number);
    setAutoCall(options?.autoCall ?? false);
    setPendingLeadId(options?.leadId);
  }, []);

  const clearPending = useCallback(() => {
    setPendingNumber(undefined);
    setAutoCall(false);
    setPendingLeadId(undefined);
  }, []);

  return (
    <SoftphoneContext.Provider value={{ pendingNumber, autoCall, pendingLeadId, dial, clearPending }}>
      {children}
    </SoftphoneContext.Provider>
  );
}
