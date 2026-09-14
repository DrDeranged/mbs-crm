import { createContext, useContext, useState, type ReactNode } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLead,
  getGetLeadQueryKey,
  useChangeLeadStatus,
  StatusChangeStatus,
  getListLeadActivityQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

type LeadDetailContextValue = {
  id: number;
  lead: any;
  isLoading: boolean;
  status: string | undefined;
  changeStatus: ReturnType<typeof useChangeLeadStatus>;
  fundedDialogOpen: boolean;
  setFundedDialogOpen: (open: boolean) => void;
  fundedAmountInput: string;
  setFundedAmountInput: (value: string) => void;
  handleStatusChange: (newStatus: string) => void;
  handleConfirmFunded: () => void;
};

const LeadDetailContext = createContext<LeadDetailContextValue | null>(null);

export function LeadDetailProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lead, isLoading } = useGetLead(id, {
    query: { enabled: !!id, queryKey: getGetLeadQueryKey(id) },
  });
  const changeStatus = useChangeLeadStatus();
  const [fundedDialogOpen, setFundedDialogOpen] = useState(false);
  const [fundedAmountInput, setFundedAmountInput] = useState("");

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
        status: lead?.status,
        changeStatus,
        fundedDialogOpen,
        setFundedDialogOpen,
        fundedAmountInput,
        setFundedAmountInput,
        handleStatusChange,
        handleConfirmFunded,
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