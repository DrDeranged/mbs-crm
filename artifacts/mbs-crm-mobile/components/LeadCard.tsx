import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";

interface Lead {
  id: number;
  businessName?: string | null;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  phone?: string | null;
  status: string;
  loanAmountRequested?: number | null;
  createdAt?: string | null;
}

interface LeadCardProps {
  lead: Lead;
}

function formatCurrency(amount?: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function timeAgo(date?: string | null): string {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function LeadCard({ lead }: LeadCardProps) {
  const colors = useColors();
  const router = useRouter();

  const ownerName = [lead.ownerFirstName, lead.ownerLastName]
    .filter(Boolean)
    .join(" ");
  const businessName = lead.businessName || ownerName || "Unknown Business";

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => router.push(`/lead/${lead.id}`)}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.topRow}>
        <View style={styles.titleGroup}>
          <Text
            style={[styles.businessName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {businessName}
          </Text>
          {ownerName && businessName !== ownerName && (
            <Text style={[styles.ownerName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {ownerName}
            </Text>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>

      <View style={styles.bottomRow}>
        <StatusBadge status={lead.status} small />
        <View style={styles.meta}>
          {lead.loanAmountRequested != null && (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {formatCurrency(lead.loanAmountRequested)}
            </Text>
          )}
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {timeAgo(lead.createdAt)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleGroup: {
    flex: 1,
    marginRight: 8,
  },
  businessName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  ownerName: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
