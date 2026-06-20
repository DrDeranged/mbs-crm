import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

type Status =
  | "new"
  | "contacted"
  | "qualified"
  | "application"
  | "submitted"
  | "approved"
  | "funded"
  | "lost"
  | "declined"
  | string;

interface StatusBadgeProps {
  status: Status;
  small?: boolean;
}

function getStatusConfig(status: Status): { label: string; bg: string; fg: string } {
  switch (status?.toLowerCase()) {
    case "new":
      return { label: "New", bg: "#DBEAFE", fg: "#1D4ED8" };
    case "contacted":
      return { label: "Contacted", bg: "#EDE9FE", fg: "#7C3AED" };
    case "qualified":
      return { label: "Qualified", bg: "#CCFBF1", fg: "#0F766E" };
    case "application":
      return { label: "Application", bg: "#FEF3C7", fg: "#B45309" };
    case "submitted":
      return { label: "Submitted", bg: "#FEF9C3", fg: "#A16207" };
    case "approved":
      return { label: "Approved", bg: "#DCFCE7", fg: "#15803D" };
    case "funded":
      return { label: "Funded", bg: "#D1FAE5", fg: "#065F46" };
    case "lost":
      return { label: "Lost", bg: "#FEE2E2", fg: "#B91C1C" };
    case "declined":
      return { label: "Declined", bg: "#F3F4F6", fg: "#6B7280" };
    default:
      return { label: status ?? "Unknown", bg: "#F3F4F6", fg: "#6B7280" };
  }
}

export function StatusBadge({ status, small = false }: StatusBadgeProps) {
  useColors();
  const cfg = getStatusConfig(status);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg },
        small && styles.small,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: cfg.fg },
          small && styles.smallText,
        ]}
      >
        {cfg.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    alignSelf: "flex-start",
  },
  small: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  smallText: {
    fontSize: 10,
  },
});
