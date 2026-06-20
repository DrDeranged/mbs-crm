import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCreateLead } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

interface FormData {
  ownerFirstName: string;
  ownerLastName: string;
  businessName: string;
  email: string;
  phone: string;
  loanAmountRequested: string;
  applicationType: string;
}

const APPLICATION_TYPES = [
  { label: "Working Capital", value: "working_capital" },
  { label: "Equipment", value: "equipment" },
  { label: "Real Estate", value: "real_estate" },
  { label: "Line of Credit", value: "line_of_credit" },
  { label: "SBA Loan", value: "sba" },
];

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  required,
  colors,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
  required?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label}
        {required && <Text style={{ color: colors.destructive }}> *</Text>}
      </Text>
      <TextInput
        style={[
          styles.input,
          { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
        ]}
        placeholder={placeholder ?? label}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={keyboardType === "email-address" ? "none" : "words"}
      />
    </View>
  );
}

export default function NewLeadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isOnline, queueMutation } = useOffline();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [form, setForm] = useState<FormData>({
    ownerFirstName: "",
    ownerLastName: "",
    businessName: "",
    email: "",
    phone: "",
    loanAmountRequested: "",
    applicationType: "",
  });
  const [error, setError] = useState<string>("");
  const [duplicateLeadId, setDuplicateLeadId] = useState<number | null>(null);

  const updateField = (key: keyof FormData) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
    setDuplicateLeadId(null);
  };

  const { mutateAsync: createLead, isPending } = useCreateLead();

  const validate = (): string => {
    if (!form.ownerFirstName.trim()) return "First name is required.";
    if (!form.ownerLastName.trim()) return "Last name is required.";
    if (!form.businessName.trim()) return "Business name is required.";
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return "Please enter a valid email address.";
    }
    return "";
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = {
      firstName: form.ownerFirstName.trim(),
      lastName: form.ownerLastName.trim(),
      companyName: form.businessName.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      applicationType: (form.applicationType || undefined) as "equipment" | "working_capital" | undefined,
    };

    if (!isOnline) {
      await queueMutation({ endpoint: "/api/leads", method: "POST", body: payload });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/leads");
      return;
    }

    try {
      const lead = await createLead({ data: payload });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push(`/lead/${(lead as { id: number }).id}`);
    } catch (err: unknown) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const apiErr = err as { response?: { status?: number; data?: { existingLeadId?: number } } };
      if (apiErr?.response?.status === 409) {
        const id = apiErr.response.data?.existingLeadId;
        setDuplicateLeadId(id ?? null);
        setError("A lead with this information already exists.");
      } else {
        setError("Failed to create lead. Please try again.");
      }
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>New Lead</Text>
      </View>

      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            OWNER INFORMATION
          </Text>
          <Field label="First Name" value={form.ownerFirstName} onChangeText={updateField("ownerFirstName")} required colors={colors} />
          <Field label="Last Name" value={form.ownerLastName} onChangeText={updateField("ownerLastName")} required colors={colors} />
          <Field label="Business Name" value={form.businessName} onChangeText={updateField("businessName")} required colors={colors} />
          <Field label="Email" value={form.email} onChangeText={updateField("email")} keyboardType="email-address" placeholder="optional" colors={colors} />
          <Field label="Phone" value={form.phone} onChangeText={updateField("phone")} keyboardType="phone-pad" placeholder="optional" colors={colors} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
            FINANCING
          </Text>
          <Field label="Loan Amount Requested" value={form.loanAmountRequested} onChangeText={updateField("loanAmountRequested")} keyboardType="numeric" placeholder="e.g. 50000" colors={colors} />

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.foreground }]}>Application Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeRow}>
              {APPLICATION_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  onPress={() => updateField("applicationType")(
                    form.applicationType === t.value ? "" : t.value
                  )}
                  style={[
                    styles.typeChip,
                    {
                      backgroundColor: form.applicationType === t.value ? colors.primary : colors.background,
                      borderColor: form.applicationType === t.value ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[
                    styles.typeChipText,
                    { color: form.applicationType === t.value ? "#fff" : colors.mutedForeground },
                  ]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            {duplicateLeadId && (
              <TouchableOpacity
                onPress={() => router.push(`/lead/${duplicateLeadId}`)}
                style={[styles.dupLink, { borderColor: colors.destructive }]}
              >
                <Text style={[styles.dupLinkText, { color: colors.destructive }]}>View existing lead</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.primary }, isPending && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={isPending}
          activeOpacity={0.85}
        >
          {isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {isOnline ? "Create Lead" : "Queue for Sync"}
            </Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    gap: 14,
  },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  typeRow: { gap: 8 },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 99,
    borderWidth: 1,
  },
  typeChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  errorBox: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  dupLink: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: "flex-start",
  },
  dupLinkText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
