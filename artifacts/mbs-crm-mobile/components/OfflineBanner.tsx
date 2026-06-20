import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const { isOnline, queuedMutations, isSyncing } = useOffline();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  if (isOnline && !isSyncing) return null;

  const count = queuedMutations.length;
  const plural = count !== 1 ? "s" : "";

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: isSyncing ? colors.primary : colors.warning,
          top: topInset,
        },
      ]}
    >
      <Feather name={isSyncing ? "refresh-cw" : "wifi-off"} size={13} color="#fff" />
      <Text style={styles.text}>
        {isSyncing
          ? `Syncing ${count} change${plural}…`
          : `Offline${count > 0 ? ` · ${count} change${plural} pending` : ""}`}
      </Text>
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
