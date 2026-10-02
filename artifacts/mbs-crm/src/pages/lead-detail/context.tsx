import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLead,
  getGetLeadQueryKey,
  useGetMe,
  useChangeLeadStatus,
  StatusChangeStatus,
  getListLeadActivityQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

type LeadDetailContextValue = {
  id: number;
  lead: any;
  isLoading: boolean;
  error: unknown;
  isAdmin: boolean;
  retry: () => void;
  status: string | undefined;
  changeStatus: ReturnType<typeof useChangeLeadStatus>;
  fundedDialogOpen: boolean;
  setFundedDialogOpen: (open: boolean) => void;
  fundedAmountInput: string;
  setFundedAmountInput: (value: string) => void;
  handleStatusChange: (newStatus: string) => void;
  handleConfirmFunded: () => void;
  requestedAction: { action: "upload" | "edit" | "note" | "task"; sequence: number } | null;
  requestAction: (action: "upload" | "edit" | "note" | "task") => void;
  consumeAction: (sequence: number) => void;
};

const LeadDetailContext = createContext<LeadDetailContextValue | null>(null);

export function LeadDetailProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: lead,
    isLoading,
    error,
    refetch,
  } = useGetLead(id, {
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) },
  });
  const { data: me } = useGetMe();
  const changeStatus = useChangeLeadStatus();
  const [fundedDialogOpen, setFundedDialogOpen] = useState(false);
  const [fundedAmountInput, setFundedAmountInput] = useState("");
  const [requestedAction, setRequestedAction] = useState<LeadDetailContextValue["requestedAction"]>(null);
  const actionSequence = useRef(0);
  const requestAction = (action: "upload" | "edit" | "note" | "task") => {
    actionSequence.current += 1;
    setRequestedAction({ action, sequence: actionSequence.current });
  };
  const consumeAction = (sequence: number) => {
    setRequestedAction((current) => current?.sequence === sequence ? null : current);
  };

  const submitStatusChange = (newStatus: string, fundedAmount?: number) => {
    changeStatus.mutate(
      {
        id,
        data: {
          status: newStatus as StatusChangeStatus,
          ...(fundedAmount !== undefined ? { fundedAmount } : {}),
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Status Updated", description: "Lead status has been changed." });
          queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListLeadActivityQueryKey(id) });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to change status.", variant: "destructive" });
        },
      },
    );
  };

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "funded") {
      setFundedAmountInput(lead?.requestedAmount != null ? String(lead.requestedAmount) : "");
      setFundedDialogOpen(true);
      return;
    }
    submitStatusChange(newStatus);
  };

  const handleConfirmFunded = () => {
    const amount = parseInt(fundedAmountInput, 10);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Error", description: "Please enter a valid funded amount.", variant: "destructive" });
      return;
    }
    submitStatusChange("funded", amount);
    setFundedDialogOpen(false);
  };

  return (
    <LeadDetailContext.Provider
      value={{
        id,
        lead,
        isLoading,
        error,
        isAdmin: me?.role === "admin",
        retry: () => {
          void refetch();
        },
        status: lead?.status,
        changeStatus,
        fundedDialogOpen,
        setFundedDialogOpen,
        fundedAmountInput,
        setFundedAmountInput,
        handleStatusChange,
        handleConfirmFunded,
        requestedAction,
        requestAction,
        consumeAction,
      }}
    >
      {children}
    </LeadDetailContext.Provider>
  );
}

export function useLeadDetail() {
  const context = useContext(LeadDetailContext);
  if (!context) throw new Error("useLeadDetail must be used within LeadDetailProvider");
  return context;
}

export function useLeadDetailAction(action: "upload" | "edit" | "note" | "task", onRequest: () => void) {
  const { requestedAction, consumeAction } = useLeadDetail();
  useEffect(() => {
    if (requestedAction?.action !== action) return;
    onRequest();
    consumeAction(requestedAction.sequence);
  }, [action, consumeAction, onRequest, requestedAction]);
}