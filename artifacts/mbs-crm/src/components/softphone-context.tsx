import { createContext, useState, useCallback, ReactNode, useMemo } from "react";
import { useLocation } from "wouter";
import { getGetLeadApplicationQueryKey, getGetLeadQueryKey, useGetLead, useGetLeadApplication } from "@workspace/api-client-react";
import { hasRecordedSmsConsent } from "@/lib/softphoneConsent";

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
  currentLead: { id: number; phone: string | null; smsEligible: boolean } | null;
  pendingTextLeadId: number | undefined;
  openTextComposer: (leadId: number) => void;
  clearTextComposer: () => void;
}

export const SoftphoneContext = createContext<SoftphoneContextValue>({
  pendingNumber: undefined,
  autoCall: false,
  pendingLeadId: undefined,
  dial: () => {},
  clearPending: () => {},
  currentLead: null,
  pendingTextLeadId: undefined,
  openTextComposer: () => {},
  clearTextComposer: () => {},
});

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const leadMatch = location.match(/^\/leads\/(\d+)/);
  const currentLeadId = leadMatch ? Number(leadMatch[1]) : 0;
  const { data: lead } = useGetLead(currentLeadId, { query: { enabled: currentLeadId > 0, queryKey: getGetLeadQueryKey(currentLeadId) } });
  const { data: application } = useGetLeadApplication(currentLeadId, { query: { enabled: currentLeadId > 0, queryKey: getGetLeadApplicationQueryKey(currentLeadId) } });
  const [pendingNumber, setPendingNumber] = useState<string | undefined>(undefined);
  const [autoCall, setAutoCall] = useState(false);
  const [pendingLeadId, setPendingLeadId] = useState<number | undefined>(undefined);
  const [pendingTextLeadId, setPendingTextLeadId] = useState<number | undefined>(undefined);
  const currentLead = useMemo(() => currentLeadId > 0 && lead
    ? {
        id: currentLeadId,
        phone: lead.phone ?? null,
        smsEligible: hasRecordedSmsConsent(application),
      }
    : null, [currentLeadId, lead, application]);

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

  const openTextComposer = useCallback((leadId: number) => setPendingTextLeadId(leadId), []);
  const clearTextComposer = useCallback(() => setPendingTextLeadId(undefined), []);

  return (
    <SoftphoneContext.Provider value={{ pendingNumber, autoCall, pendingLeadId, dial, clearPending, currentLead, pendingTextLeadId, openTextComposer, clearTextComposer }}>
      {children}
    </SoftphoneContext.Provider>
  );
}
