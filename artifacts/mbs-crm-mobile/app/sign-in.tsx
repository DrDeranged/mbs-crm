import { useSignIn, useSSO } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import * as AuthSession from "expo-auth-session";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const isLoading = loading || fetchStatus === "fetching";

  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { error: signInError } = await signIn.password({
        emailAddress: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError(signInError.message ?? "An error occurred. Please check your credentials.");
        return;
      }

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: async ({ session }) => {
            if (session?.currentTask) {
              setError("Additional account verification is required.");
              return;
            }
            router.replace("/(tabs)");
          },
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setError("Sign-in could not be completed. Please try again.");
      }
    } catch (err: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const clerkErr = err as { errors?: { message: string }[] };
      const message =
        clerkErr?.errors?.[0]?.message ??
        "An error occurred. Please check your credentials.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: AuthSession.makeRedirectUri(),
      });

      if (!createdSessionId || !setActive) {
        setError("Google sign-in could not be completed. Please try again.");
        return;
      }

      await setActive({
        session: createdSessionId,
        navigate: async ({ session }) => {
          if (session?.currentTask) {
            setError("Additional account verification is required.");
            return;
          }
          router.replace("/(tabs)");
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const clerkErr = err as { errors?: { message: string }[] };
      setError(clerkErr?.errors?.[0]?.message ?? "Google sign-in could not be completed.");
    } finally {
      setLoading(false);
    }
  }, [router, startSSOFlow]);

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.container, { paddingTop: topPad + 40 }]}>
        <View style={styles.logoArea}>
          <View style={[styles.logoIcon, { backgroundColor: colors.primary }]}>
            <Feather name="briefcase" size={28} color="#fff" />
          </View>
          <Text style={[styles.logoText, { color: colors.foreground }]}>MBS CRM</Text>
          <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
            Business Financing Platform
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              placeholder="you@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(""); }}
              returnKeyType="next"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput
                style={[
                  styles.input,
                  styles.passwordInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedForeground}
                secureTextEntry={!showPassword}
                autoComplete="password"
                textContentType="password"
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Feather
                  name={showPassword ? "eye-off" : "eye"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          </View>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
              <Feather name="alert-circle" size={14} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.googleBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
              isLoading && styles.btnDisabled,
            ]}
            onPress={handleGoogleSignIn}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            <Feather name="globe" size={18} color={colors.foreground} />
            <Text style={[styles.googleBtnText, { color: colors.foreground }]}>
              Continue with Google
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.signInBtn,
              { backgroundColor: colors.primary },
              isLoading && styles.btnDisabled,
            ]}
            onPress={handleSignIn}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.signInBtnText}>Sign In</Text>
            )}
          </TouchableOpacity>
          {errors.fields.identifier?.message ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>
              {errors.fields.identifier.message}
            </Text>
          ) : null}
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Contact your administrator for access.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  logoArea: {
    alignItems: "center",
    marginBottom: 40,
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  logoText: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  form: {
    gap: 16,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginLeft: 1,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  passwordWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 46,
  },
  eyeBtn: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  signInBtn: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  googleBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  googleBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  signInBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: "auto",
    paddingTop: 24,
  },
});
