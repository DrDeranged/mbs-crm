import { Feather } from "@expo/vector-icons";
import { useAuth } from "@clerk/clerk-expo";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const { isOnline, queuedMutations, isSyncing } = useOffline();
  const { userId } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const pendingCount = queuedMutations.filter(
    (mutation) => mutation.ownerUserId === userId && !mutation.blockedReason,
  ).length;
  const blockedCount = queuedMutations.length - pendingCount;

  if (isOnline && !isSyncing && blockedCount === 0) return null;

  const pendingPlural = pendingCount !== 1 ? "s" : "";
  const blockedPlural = blockedCount !== 1 ? "s" : "";
  const message = isSyncing
    ? `Syncing ${pendingCount} change${pendingPlural}…`
    : [
        !isOnline ? "Offline" : null,
        pendingCount > 0 ? `${pendingCount} change${pendingPlural} pending` : null,
        blockedCount > 0
          ? `${blockedCount} change${blockedPlural} blocked. Sign in with the creating account; older unowned changes need review.`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: isSyncing && blockedCount === 0 ? colors.primary : colors.warning,
          top: topInset,
        },
      ]}
    >
      <Feather
        name={blockedCount > 0 ? "lock" : isSyncing ? "refresh-cw" : "wifi-off"}
        size={13}
        color="#fff"
      />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    gap: 6,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
