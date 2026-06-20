import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

export function OfflineBanner() {
  const { isOnline, queuedMutations } = useOffline();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (isOnline) return null;

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: colors.warning,
          top: topInset,
        },
      ]}
    >
      <Feather name="wifi-off" size={13} color="#fff" />
      <Text style={styles.text}>
        Offline
        {queuedMutations.length > 0
          ? ` · ${queuedMutations.length} change${queuedMutations.length !== 1 ? "s" : ""} pending`
          : ""}
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
