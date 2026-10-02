import { createContext, useState, useCallback, ReactNode, useMemo } from "react";
import { useLocation } from "wouter";
import { getGetLeadApplicationQueryKey, getGetLeadQueryKey, useGetLead, useGetLeadApplication } from "@workspace/api-client-react";
import { hasRecordedSmsConsent } from "@/lib/softphoneConsent";
import { formatLeadIdentity } from "@/lib/recordIdentity";

interface DialOptions {
  autoCall?: boolean;
  leadId?: number;
}

interface SoftphoneContextValue {
  pendingNumber: string | undefined;
  autoCall: boolean;
  pendingLeadId: number | undefined;
  dial: (number: string, options?: DialOptions) => void;
  softphoneAvailable: boolean;
  setSoftphoneAvailable: (available: boolean) => void;
  clearPending: () => void;
  currentLead: { id: number; name: string; companyName: string | null; email: string | null; phone: string | null; smsEligible: boolean } | null;
  pendingTextLeadId: number | undefined;
  openTextComposer: (leadId: number) => void;
  clearTextComposer: () => void;
  pendingEmailLeadId: number | undefined;
  composerAvailable: boolean;
  openEmailComposer: (leadId: number) => void;
  clearEmailComposer: () => void;
}

export const SoftphoneContext = createContext<SoftphoneContextValue>({
  pendingNumber: undefined,
  autoCall: false,
  pendingLeadId: undefined,
  dial: () => {},
  softphoneAvailable: false,
  setSoftphoneAvailable: () => {},
  clearPending: () => {},
  currentLead: null,
  pendingTextLeadId: undefined,
  openTextComposer: () => {},
  clearTextComposer: () => {},
  pendingEmailLeadId: undefined,
  openEmailComposer: () => {},
  composerAvailable: false,
  clearEmailComposer: () => {},
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
  const [pendingEmailLeadId, setPendingEmailLeadId] = useState<number | undefined>(undefined);
  const [softphoneAvailable, setSoftphoneAvailable] = useState(false);
  const currentLead = useMemo(() => currentLeadId > 0 && lead
    ? {
        id: currentLeadId,
        name: formatLeadIdentity(lead),
        companyName: lead.companyName ?? null,
        email: lead.email ?? null,
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
  const openEmailComposer = useCallback((leadId: number) => setPendingEmailLeadId(leadId), []);
  const clearEmailComposer = useCallback(() => setPendingEmailLeadId(undefined), []);

  return (
    <SoftphoneContext.Provider value={{
      pendingNumber,
      autoCall,
      pendingLeadId,
      dial,
      softphoneAvailable,
      setSoftphoneAvailable,
      clearPending,
      currentLead,
      pendingTextLeadId,
      openTextComposer,
      clearTextComposer,
      pendingEmailLeadId,
      openEmailComposer,
      composerAvailable: true,
      clearEmailComposer,
    }}>
      {children}
    </SoftphoneContext.Provider>
  );
}
