import { useAuth, useUser } from "@clerk/clerk-expo";
import { useGetMe } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const BIOMETRIC_KEY = "@mbs_biometric_enabled";
const PUSH_KEY = "@mbs_push_enabled";

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  rep: "Sales Rep",
};

export default function SettingsScreen() {
  const { signOut, getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { data: meData } = useGetMe();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [biometricEnabled, setBiometricEnabled] = useState<boolean>(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean>(false);
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);
  const [pushLoading, setPushLoading] = useState<boolean>(false);

  useEffect(() => {
    AsyncStorage.getItem(BIOMETRIC_KEY).then((v) => setBiometricEnabled(v === "1"));
    AsyncStorage.getItem(PUSH_KEY).then((v) => setPushEnabled(v === "1"));
    if (Platform.OS !== "web") {
      LocalAuthentication.hasHardwareAsync().then(setBiometricAvailable);
    }
  }, []);

  const toggleBiometric = async (value: boolean) => {
    if (value && Platform.OS !== "web") {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to enable biometric unlock",
        fallbackLabel: "Use Passcode",
      });
      if (!result.success) return;
    }
    await Haptics.selectionAsync();
    await AsyncStorage.setItem(BIOMETRIC_KEY, value ? "1" : "0");
    setBiometricEnabled(value);
  };

  const togglePushNotifications = async (value: boolean) => {
    if (Platform.OS === "web") return;
    setPushLoading(true);
    try {
      if (value) {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Enable notifications in your device settings.");
          setPushLoading(false);
          return;
        }
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_REPL_ID,
        });
        await storePushToken(tokenData.data, getToken);
        await AsyncStorage.setItem(PUSH_KEY, "1");
        setPushEnabled(true);
      } else {
        await storePushToken(null, getToken);
        await AsyncStorage.setItem(PUSH_KEY, "0");
        setPushEnabled(false);
      }
    } finally {
      setPushLoading(false);
    }
    await Haptics.selectionAsync();
  };

  const handleSignOut = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await signOut();
            router.replace("/sign-in");
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  const me = meData as { name?: string | null; email?: string | null; role?: string } | undefined;
  const displayName = me?.name ?? clerkUser?.fullName ?? "User";
  const displayEmail = me?.email ?? clerkUser?.primaryEmailAddress?.emailAddress ?? "";
  const displayRole = me?.role ? (ROLE_LABELS[me.role] ?? me.role) : "";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.profileCard, { backgroundColor: colors.primary }]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{displayEmail}</Text>
            {displayRole ? (
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>{displayRole}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {biometricAvailable && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SECURITY</Text>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: "#F3F4F6" }]}>
                  <Feather name="lock" size={16} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>Biometric Unlock</Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                    Face ID / Fingerprint
                  </Text>
                </View>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={toggleBiometric}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
        )}

        {Platform.OS !== "web" && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>NOTIFICATIONS</Text>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: "#F3F4F6" }]}>
                  <Feather name="bell" size={16} color={colors.primary} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: colors.foreground }]}>
                    Push Notifications
                  </Text>
                  <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
                    Lead updates & task reminders
                  </Text>
                </View>
              </View>
              {pushLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Switch
                  value={pushEnabled}
                  onValueChange={togglePushNotifications}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor="#fff"
                />
              )}
            </View>
          </View>
        )}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
          <TouchableOpacity
            style={styles.row}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.rowIcon, { backgroundColor: "#FEE2E2" }]}>
                <Feather name="log-out" size={16} color={colors.destructive} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.destructive }]}>
                {signingOut ? "Signing out…" : "Sign Out"}
              </Text>
            </View>
            {signingOut && <ActivityIndicator size="small" color={colors.destructive} />}
          </TouchableOpacity>
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          MBS CRM Mobile v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}

async function storePushToken(
  token: string | null,
  getToken: () => Promise<string | null>,
): Promise<void> {
  try {
    const authToken = await getToken();
    await fetch(`https://${process.env.EXPO_PUBLIC_DOMAIN}/api/me/push-token`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ pushToken: token }),
    });
  } catch {
    // non-critical
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  profileCard: {
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", marginTop: 2 },
  roleBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 6,
  },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" },
  section: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 16 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  rowIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  version: { textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8 },
});
