import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth, ClerkProvider } from "@clerk/clerk-expo";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Feather } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl, useUpdateMyPushToken } from "@workspace/api-client-react";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as SystemUI from "expo-system-ui";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  type AppStateStatus,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import { OfflineProvider, useOffline } from "@/context/OfflineContext";
import { tokenCache } from "@/lib/tokenCache";

SplashScreen.preventAutoHideAsync();
SystemUI.setBackgroundColorAsync("#1F4E79");

setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const BIOMETRIC_KEY = "@mbs_biometric_enabled";
const LOCK_TIMEOUT_MS = 30_000;

function ApiTokenSync() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) {
      setAuthTokenGetter(() => getToken());
    } else {
      setAuthTokenGetter(null);
    }
  }, [isSignedIn, getToken]);

  return null;
}

function PushTokenSync() {
  const { isSignedIn } = useAuth();
  const { mutateAsync: updatePushToken } = useUpdateMyPushToken();
  const registered = useRef(false);

  useEffect(() => {
    if (!isSignedIn || registered.current || Platform.OS === "web") return;

    async function register() {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== "granted") return;
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_REPL_ID,
        });
        await updatePushToken({ data: { pushToken: tokenData.data } });
        registered.current = true;
      } catch {
        // non-critical
      }
    }

    register();
  }, [isSignedIn, updatePushToken]);

  return null;
}

function SyncWorker() {
  const { isOnline, queuedMutations, removeFromQueue, setSyncing } = useOffline();
  const { getToken, isSignedIn } = useAuth();
  const wasOnline = useRef<boolean | null>(null);

  useEffect(() => {
    const justCameOnline = wasOnline.current === false && isOnline;
    wasOnline.current = isOnline;

    if (!justCameOnline || !isSignedIn || queuedMutations.length === 0) return;

    let cancelled = false;

    async function replay() {
      setSyncing(true);
      for (const mutation of queuedMutations) {
        if (cancelled) break;
        try {
          const token = await getToken();
          const res = await fetch(
            `https://${process.env.EXPO_PUBLIC_DOMAIN}${mutation.endpoint}`,
            {
              method: mutation.method,
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify(mutation.body),
            },
          );
          if (res.ok || res.status === 409) {
            if (res.status === 409) {
              Alert.alert(
                "Sync Conflict",
                "A queued change conflicted with a server update and was discarded.",
              );
            }
            await removeFromQueue(mutation.id);
          }
        } catch {
          // keep in queue for next retry
        }
      }
      if (!cancelled) setSyncing(false);
    }

    replay();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return null;
}

function NotificationResponseHandler() {
  const router = useRouter();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown>;
      if (data?.leadId) {
        router.push(`/lead/${data.leadId as string | number}`);
      }
    });
    return () => sub.remove();
  }, [router]);

  return null;
}

function BiometricGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked] = useState(false);
  const appStateRef = useRef<AppStateStatus>("active");
  const backgroundedAt = useRef<number | null>(null);

  const attemptUnlock = useCallback(async () => {
    if (Platform.OS === "web") {
      setLocked(false);
      return;
    }
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock MBS CRM",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });
      if (result.success) setLocked(false);
    } catch {
      // prompt stays visible — user must tap Unlock
    }
  }, []);

  useEffect(() => {
    async function init() {
      if (Platform.OS === "web") return;
      const enabled = await AsyncStorage.getItem(BIOMETRIC_KEY);
      if (enabled === "1") {
        setLocked(true);
        attemptUnlock();
      }
    }
    init();

    const sub = AppState.addEventListener("change", async (nextState: AppStateStatus) => {
      if (
        appStateRef.current === "active" &&
        (nextState === "background" || nextState === "inactive")
      ) {
        backgroundedAt.current = Date.now();
      } else if (nextState === "active" && backgroundedAt.current !== null) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed > LOCK_TIMEOUT_MS && Platform.OS !== "web") {
          const enabled = await AsyncStorage.getItem(BIOMETRIC_KEY);
          if (enabled === "1") {
            setLocked(true);
            attemptUnlock();
          }
        }
      }
      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [attemptUnlock]);

  if (locked) {
    return (
      <View style={lockStyles.container}>
        <Feather name="lock" size={48} color="#fff" />
        <Text style={lockStyles.appName}>MBS CRM</Text>
        <Text style={lockStyles.subtitle}>Authentication required</Text>
        <TouchableOpacity onPress={attemptUnlock} style={lockStyles.unlockBtn} activeOpacity={0.8}>
          <Text style={lockStyles.unlockText}>Unlock</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const lockStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1F4E79",
    gap: 8,
  },
  appName: { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 12 },
  subtitle: { color: "rgba(255,255,255,0.7)", fontSize: 14 },
  unlockBtn: {
    marginTop: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 32,
  },
  unlockText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});

function RootLayoutNav() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    const inSignIn = segments[0] === "sign-in";
    if (!isSignedIn && !inSignIn) {
      router.replace("/sign-in");
    } else if (isSignedIn && inSignIn) {
      router.replace("/(tabs)");
    }
  }, [isLoaded, isSignedIn, segments, router]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen
        name="lead/[id]"
        options={{ headerShown: false, presentation: "card" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <OfflineProvider>
                  <BiometricGate>
                    <ApiTokenSync />
                    <PushTokenSync />
                    <SyncWorker />
                    <NotificationResponseHandler />
                    <RootLayoutNav />
                    <OfflineBanner />
                  </BiometricGate>
                </OfflineProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
