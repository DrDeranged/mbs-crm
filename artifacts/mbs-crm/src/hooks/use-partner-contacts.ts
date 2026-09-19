import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/lib/apiBase";

const fetcher = async (url: string, options?: RequestInit) => {
  const res = await fetch(`${getApiBaseUrl()}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "omit",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "An error occurred");
  }
  return res.status !== 204 ? res.json() : null;
};

export type PartnerContactRole = "rep" | "submissions" | "credit" | "docs" | "funding" | "other";

export interface PartnerContact {
  id: number;
  partnerId: number;
  role: PartnerContactRole;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertPartnerContact {
  role?: PartnerContactRole;
  name: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  notes?: string | null;
}

export function usePartnerContacts(partnerId: number) {
  return useQuery<PartnerContact[]>({
    queryKey: ["partnerContacts", partnerId],
    queryFn: () => fetcher(`/partners/${partnerId}/contacts`),
    enabled: !!partnerId,
  });
}

export function useCreatePartnerContact(partnerId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: InsertPartnerContact) =>
      fetcher(`/partners/${partnerId}/contacts`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnerContacts", partnerId] });
    },
  });
}

export function useUpdatePartnerContact(partnerId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, data }: { contactId: number; data: Partial<InsertPartnerContact> }) =>
      fetcher(`/partners/${partnerId}/contacts/${contactId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnerContacts", partnerId] });
    },
  });
}

export function useDeletePartnerContact(partnerId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contactId: number) =>
      fetcher(`/partners/${partnerId}/contacts/${contactId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partnerContacts", partnerId] });
    },
  });
}
