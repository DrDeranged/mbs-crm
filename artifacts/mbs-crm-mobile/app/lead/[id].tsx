import {
  useGetLead,
  useListNotes,
  useCreateNote,
  useListTasks,
  useCreateTask,
  useUpdateTask,
  useListLeadActivity,
  useChangeLeadStatus,
  useListDocuments,
  useGetLeadFinancials,
  useGetLenderMatches,
  useLogOutboundCall,
  downloadDocument,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/components/StatusBadge";
import { TaskCard } from "@/components/TaskCard";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

type Tab = "overview" | "notes" | "tasks" | "activity" | "documents" | "lenders";

const STATUS_OPTIONS = [
  "new_lead", "contacted", "application_received",
  "submitted_to_underwriting", "approved", "funded", "declined", "follow_up",
] as const;

function formatStatus(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function formatCurrency(n?: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0,
  }).format(n);
}

function InfoRow({ label, value, colors }: { label: string; value?: string | null; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[infoStyles.row, { borderBottomColor: colors.border }]}>
      <Text style={[infoStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[infoStyles.value, { color: colors.foreground }]}>{value || "—"}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 12, borderBottomWidth: 1 },
  label: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  value: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 2, textAlign: "right" },
});

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = Number(id);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [newNoteText, setNewNoteText] = useState<string>("");
  const [addingNote, setAddingNote] = useState<boolean>(false);
  const [newTaskTitle, setNewTaskTitle] = useState<string>("");
  const [addingTask, setAddingTask] = useState<boolean>(false);
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());

  const { data: lead, isLoading, refetch, isFetching } = useGetLead(leadId);
  const { data: notes, refetch: refetchNotes } = useListNotes(leadId);
  const { data: tasks, refetch: refetchTasks } = useListTasks(leadId);
  const { data: activity } = useListLeadActivity(leadId);
  const { mutateAsync: createNote, isPending: creatingNote } = useCreateNote();
  const { mutateAsync: createTask } = useCreateTask();
  const { mutateAsync: updateTask } = useUpdateTask();
  const { mutateAsync: changeStatus } = useChangeLeadStatus();
  const { data: documents } = useListDocuments(leadId);
  const { data: financialsData } = useGetLeadFinancials(leadId);
  const { data: lenderMatches } = useGetLenderMatches(leadId);
  const { mutateAsync: logCall } = useLogOutboundCall();
  const { isOnline, queueMutation } = useOffline();

  const [openingDocId, setOpeningDocId] = useState<number | null>(null);

  const [pendingNotes, setPendingNotes] = useState<Array<{ id: string; body: string }>>([]);
  const [cachedLead, setCachedLead] = useState<unknown>(undefined);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const CACHE_KEY = `@mbs_lead_${leadId}`;

  useEffect(() => {
    if (lead && isOnline) {
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(lead)).catch(() => {});
    }
  }, [lead, isOnline, CACHE_KEY]);

  useEffect(() => {
    if (!isOnline && !lead) {
      AsyncStorage.getItem(CACHE_KEY)
        .then((raw) => { if (raw) setCachedLead(JSON.parse(raw)); })
        .catch(() => {});
    }
  }, [isOnline, lead, CACHE_KEY]);

  const effectiveLead = lead ?? cachedLead;

  const leadData = effectiveLead as {
    id: number;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    email?: string | null;
    phone?: string | null;
    status: string;
    applicationType?: string | null;
    assignedRep?: { id: number; name?: string | null } | null;
    leadSource?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | undefined;

  type NoteItem = { id: number; body: string; author?: { name?: string | null } | null; createdAt?: string | null };
  type ActivityItem = { id: number; action: string; entityType?: string | null; details?: unknown; createdAt?: string | null; userName?: string | null };

  const handleCall = async () => {
    if (!leadData?.phone) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`tel:${leadData.phone}`);
    try {
      await logCall({ id: leadId, data: { toNumber: leadData.phone } });
    } catch { /* non-critical */ }
  };

  const handleSMS = async () => {
    if (!leadData?.phone) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`sms:${leadData.phone}`);
    try {
      await logCall({ id: leadId, data: { toNumber: leadData.phone, type: "sms" } });
    } catch { /* non-critical */ }
  };

  const handleOpenDocument = async (docId: number) => {
    setOpeningDocId(docId);
    try {
      const result = await downloadDocument(docId);
      const url = (result as { url?: string }).url;
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Error", "No download URL available.");
      }
    } catch {
      Alert.alert("Error", "Could not open document.");
    } finally {
      setOpeningDocId(null);
    }
  };

  const handleEmail = async () => {
    if (!leadData?.email) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`mailto:${leadData.email}`);
  };

  const handleStatusChange = () => {
    Alert.alert("Change Status", "Select new status:", [
      ...STATUS_OPTIONS.map((s) => ({
        text: formatStatus(s),
        onPress: async () => {
          if (!isOnline) {
            await queueMutation({
              endpoint: `/api/leads/${leadId}/status`,
              method: "PUT",
              body: { status: s },
            });
            setPendingStatus(s);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            return;
          }
          try {
            await changeStatus({ id: leadId, data: { status: s } });
            refetch();
          } catch {
            Alert.alert("Error", "Could not update status.");
          }
        },
      })),
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleAddNote = async () => {
    if (!newNoteText.trim()) return;
    const noteBody = newNoteText.trim();
    setAddingNote(true);
    try {
      if (!isOnline) {
        await queueMutation({
          endpoint: `/api/leads/${leadId}/notes`,
          method: "POST",
          body: { body: noteBody },
        });
        setPendingNotes((prev) => [
          { id: `pending-${Date.now()}`, body: noteBody },
          ...prev,
        ]);
        setNewNoteText("");
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      await createNote({ id: leadId, data: { body: noteBody } });
      setNewNoteText("");
      refetchNotes();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setAddingNote(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim()) return;
    setAddingTask(true);
    try {
      await createTask({ id: leadId, data: { title: newTaskTitle.trim() } });
      setNewTaskTitle("");
      refetchTasks();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Error", "Could not add task. Please try again.");
    } finally {
      setAddingTask(false);
    }
  };

  const handleCompleteTask = async (taskId: number) => {
    setCompletingIds((prev) => new Set(prev).add(taskId));
    try {
      await updateTask({ taskId, data: { isCompleted: true } });
      refetchTasks();
    } finally {
      setCompletingIds((prev) => { const n = new Set(prev); n.delete(taskId); return n; });
    }
  };

  const bottomPad = (Platform.OS === "web" ? 34 : insets.bottom) + 16;

  if (isLoading) {
    return (
      <View style={[styles.loadingCenter, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!leadData) {
    return (
      <View style={[styles.loadingCenter, { backgroundColor: colors.background }]}>
        <Feather name="alert-circle" size={32} color={colors.mutedForeground} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Lead not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.backLink, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const ownerName = [leadData.firstName, leadData.lastName].filter(Boolean).join(" ");
  const displayName = leadData.companyName || ownerName || "Unknown Lead";

  const lenderMatchList = lenderMatches as Array<{
    id: number;
    matchScore: number;
    lender?: { id: number; name: string } | null;
    criteriaBreakdown?: Array<{ criterion: string; passed: boolean; skipped?: boolean; detail?: string }> | null;
    matchedAt?: string | null;
  }> | undefined;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "notes", label: `Notes${notes ? ` (${(notes as NoteItem[]).length})` : ""}` },
    { key: "tasks", label: `Tasks${tasks ? ` (${(tasks as unknown[]).length})` : ""}` },
    { key: "activity", label: "Activity" },
    { key: "documents", label: `Docs${documents ? ` (${(documents as unknown[]).length})` : ""}` },
    { key: "lenders", label: `Lenders${lenderMatchList?.length ? ` (${lenderMatchList.length})` : ""}` },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.leadHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.leadTitleArea}>
          <Text style={[styles.leadBusinessName, { color: colors.foreground }]} numberOfLines={1}>
            {displayName}
          </Text>
          {ownerName && displayName !== ownerName && (
            <Text style={[styles.leadOwnerName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {ownerName}
            </Text>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <TouchableOpacity onPress={handleStatusChange} activeOpacity={0.7}>
              <StatusBadge status={pendingStatus ?? leadData.status} />
            </TouchableOpacity>
            {pendingStatus && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Feather name="upload" size={11} color={colors.warning} />
                <Text style={{ fontSize: 10, color: colors.warning, fontFamily: "Inter_500Medium" }}>
                  Pending sync
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      <View style={[styles.actionsRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {[
          { icon: "phone", label: "Call", onPress: handleCall, enabled: !!leadData.phone },
          { icon: "message-circle", label: "SMS", onPress: handleSMS, enabled: !!leadData.phone },
          { icon: "mail", label: "Email", onPress: handleEmail, enabled: !!leadData.email },
        ].map((action) => (
          <TouchableOpacity
            key={action.icon}
            onPress={action.onPress}
            disabled={!action.enabled}
            activeOpacity={0.7}
            style={[styles.actionBtn, { opacity: action.enabled ? 1 : 0.35 }]}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.primary + "15" }]}>
              <Feather name={action.icon as keyof typeof Feather.glyphMap} size={18} color={colors.primary} />
            </View>
            <Text style={[styles.actionLabel, { color: colors.primary }]}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[
              styles.tabItem,
              activeTab === tab.key && [styles.tabItemActive, { borderBottomColor: colors.primary }],
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: activeTab === tab.key ? colors.primary : colors.mutedForeground },
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "overview" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={colors.primary} />
          }
        >
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.infoCardTitle, { color: colors.mutedForeground }]}>CONTACT</Text>
            <InfoRow label="Owner" value={ownerName} colors={colors} />
            <InfoRow label="Business" value={leadData.companyName} colors={colors} />
            <InfoRow label="Phone" value={leadData.phone} colors={colors} />
            <InfoRow label="Email" value={leadData.email} colors={colors} />
          </View>
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
            <Text style={[styles.infoCardTitle, { color: colors.mutedForeground }]}>DETAILS</Text>
            <InfoRow label="Type" value={leadData.applicationType?.replace(/_/g, " ")} colors={colors} />
            <InfoRow label="Source" value={leadData.leadSource?.replace(/_/g, " ")} colors={colors} />
            <InfoRow label="Rep" value={leadData.assignedRep?.name} colors={colors} />
            <InfoRow label="Created" value={formatDate(leadData.createdAt)} colors={colors} />
          </View>
          {financialsData && (
            <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
              <Text style={[styles.infoCardTitle, { color: colors.mutedForeground }]}>FINANCIALS</Text>
              {(financialsData as { summary?: { avgMonthlyDeposits?: number | null; avgDailyBalance?: number | null; avgNsfsPerMonth?: number; totalNsfs?: number; monthsAnalyzed?: number } | null }).summary ? (
                <>
                  <InfoRow label="Avg Monthly Deposits" value={formatCurrency((financialsData as { summary: { avgMonthlyDeposits?: number | null } }).summary.avgMonthlyDeposits)} colors={colors} />
                  <InfoRow label="Avg Daily Balance" value={formatCurrency((financialsData as { summary: { avgDailyBalance?: number | null } }).summary.avgDailyBalance)} colors={colors} />
                  <InfoRow label="Months Analyzed" value={String((financialsData as { summary: { monthsAnalyzed?: number } }).summary.monthsAnalyzed ?? "")} colors={colors} />
                  <InfoRow label="Total NSFs" value={String((financialsData as { summary: { totalNsfs?: number } }).summary.totalNsfs ?? "")} colors={colors} />
                </>
              ) : (
                <InfoRow label="Bank Statements" value={`${(financialsData as { months?: unknown[] }).months?.length ?? 0} month(s) uploaded`} colors={colors} />
              )}
            </View>
          )}
        </ScrollView>
      )}

      {activeTab === "notes" && (
        <KeyboardAwareScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <View style={[styles.noteInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.noteTextInput, { color: colors.foreground }]}
              placeholder="Add a note…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              value={newNoteText}
              onChangeText={setNewNoteText}
              textAlignVertical="top"
            />
            <TouchableOpacity
              onPress={handleAddNote}
              disabled={!newNoteText.trim() || creatingNote || addingNote}
              style={[styles.noteSendBtn, { backgroundColor: colors.primary, opacity: newNoteText.trim() ? 1 : 0.4 }]}
            >
              {creatingNote || addingNote ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="send" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {pendingNotes.map((pn) => (
            <View key={pn.id} style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.warning, borderWidth: 1.5 }]}>
              <Text style={[styles.noteContent, { color: colors.foreground }]}>{pn.body}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                <Feather name="upload" size={11} color={colors.warning} />
                <Text style={[styles.noteMeta, { color: colors.warning }]}>Pending sync — will save when online</Text>
              </View>
            </View>
          ))}

          {(notes as NoteItem[] | undefined)?.length === 0 && pendingNotes.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="file-text" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No notes yet</Text>
            </View>
          )}

          {(notes as unknown as NoteItem[] | undefined)?.map((note) => (
            <View key={note.id} style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.noteContent, { color: colors.foreground }]}>{note.body}</Text>
              <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>
                {note.author?.name} · {formatDate(note.createdAt)}
              </Text>
            </View>
          ))}
        </KeyboardAwareScrollView>
      )}

      {activeTab === "tasks" && (
        <KeyboardAwareScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bottomOffset={24}
        >
          <View style={[styles.noteInput, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.noteTextInput, { color: colors.foreground }]}
              placeholder="Add a task…"
              placeholderTextColor={colors.mutedForeground}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              returnKeyType="done"
              onSubmitEditing={handleAddTask}
            />
            <TouchableOpacity
              onPress={handleAddTask}
              style={[styles.noteSendBtn, { backgroundColor: colors.primary, opacity: newTaskTitle.trim() ? 1 : 0.4 }]}
              disabled={!newTaskTitle.trim() || addingTask}
            >
              {addingTask ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="plus" size={16} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          {(tasks as unknown[] | undefined)?.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="check-circle" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No tasks for this lead</Text>
            </View>
          )}

          {(tasks as Array<{ id: number; title: string; description?: string | null; dueDate?: string | null; completedAt?: string | null }> | undefined)?.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={handleCompleteTask}
              isCompleting={completingIds.has(task.id)}
            />
          ))}
        </KeyboardAwareScrollView>
      )}

      {activeTab === "activity" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 0 }}
          showsVerticalScrollIndicator={false}
        >
          {(activity as ActivityItem[] | undefined)?.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="activity" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No activity yet</Text>
            </View>
          )}
          {(activity as ActivityItem[] | undefined)?.map((entry, idx) => (
            <View key={entry.id} style={styles.activityRow}>
              <View style={styles.activityLine}>
                <View style={[styles.activityDot, { backgroundColor: colors.primary }]} />
                {idx < ((activity as ActivityItem[]).length - 1) && (
                  <View style={[styles.activityConnector, { backgroundColor: colors.border }]} />
                )}
              </View>
              <View style={styles.activityContent}>
                <Text style={[styles.activityAction, { color: colors.foreground }]}>
                  {entry.userName ? `${entry.userName} ` : ""}
                  <Text style={{ color: colors.mutedForeground }}>{entry.action}</Text>
                  {entry.entityType ? ` ${entry.entityType}` : ""}
                </Text>
                <Text style={[styles.activityTime, { color: colors.mutedForeground }]}>
                  {formatDate(entry.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === "lenders" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {!lenderMatchList?.length && (
            <View style={styles.emptyState}>
              <Feather name="award" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No lender matches yet</Text>
              <Text style={[styles.emptySubText, { color: colors.mutedForeground }]}>
                Run the matching engine from the web CRM to see ranked lenders
              </Text>
            </View>
          )}
          {lenderMatchList?.map((match) => (
            <View key={match.id} style={[styles.lenderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.lenderCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lenderName, { color: colors.foreground }]} numberOfLines={1}>
                    {match.lender?.name ?? "Unknown Lender"}
                  </Text>
                  {match.matchedAt && (
                    <Text style={[styles.lenderMeta, { color: colors.mutedForeground }]}>
                      Matched {formatDate(match.matchedAt)}
                    </Text>
                  )}
                </View>
                <View style={[
                  styles.scoreBadge,
                  { backgroundColor: match.matchScore >= 80 ? colors.success + "20" : match.matchScore >= 50 ? colors.warning + "20" : colors.destructive + "20" },
                ]}>
                  <Text style={[
                    styles.scoreText,
                    { color: match.matchScore >= 80 ? colors.success : match.matchScore >= 50 ? colors.warning : colors.destructive },
                  ]}>
                    {match.matchScore}%
                  </Text>
                </View>
              </View>
              {match.criteriaBreakdown && match.criteriaBreakdown.length > 0 && (
                <View style={styles.criteriaList}>
                  {match.criteriaBreakdown.slice(0, 4).map((c, i) => (
                    <View key={i} style={styles.criteriaRow}>
                      <Feather
                        name={c.skipped ? "minus" : c.passed ? "check-circle" : "x-circle"}
                        size={13}
                        color={c.skipped ? colors.mutedForeground : c.passed ? colors.success : colors.destructive}
                      />
                      <Text style={[styles.criteriaText, { color: c.skipped ? colors.mutedForeground : colors.foreground }]} numberOfLines={1}>
                        {c.criterion}{c.detail ? ` — ${c.detail}` : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      {activeTab === "documents" && (
        <ScrollView
          style={styles.tabContent}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {!(documents as unknown[] | undefined)?.length && (
            <View style={styles.emptyState}>
              <Feather name="folder" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No documents uploaded</Text>
            </View>
          )}
          {(documents as Array<{
            id: number;
            filename: string;
            fileType: string;
            fileSize: number;
            createdAt: string;
            uploader?: { name?: string | null } | null;
          }> | undefined)?.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              onPress={() => handleOpenDocument(doc.id)}
              activeOpacity={0.7}
              style={[styles.docCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={[styles.docIconWrap, { backgroundColor: colors.primary + "15" }]}>
                {openingDocId === doc.id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="file-text" size={20} color={colors.primary} />
                )}
              </View>
              <View style={styles.docInfo}>
                <Text style={[styles.docName, { color: colors.foreground }]} numberOfLines={1}>
                  {doc.filename}
                </Text>
                <Text style={[styles.docMeta, { color: colors.mutedForeground }]}>
                  {doc.fileType.toUpperCase()} · {(doc.fileSize / 1024).toFixed(0)} KB
                  {doc.uploader?.name ? ` · ${doc.uploader.name}` : ""}
                </Text>
                <Text style={[styles.docMeta, { color: colors.mutedForeground }]}>
                  {formatDate(doc.createdAt)}
                </Text>
              </View>
              <Feather name="download" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loadingCenter: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  backLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  leadHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  backBtn: { marginTop: 4 },
  leadTitleArea: { flex: 1 },
  leadBusinessName: { fontSize: 20, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  leadOwnerName: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: 2 },
  actionsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  actionBtn: { flex: 1, alignItems: "center", gap: 5 },
  actionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actionLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabItemActive: {},
  tabLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tabContent: { flex: 1 },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  infoCardTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginBottom: 4 },
  noteInput: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    minHeight: 72,
  },
  noteTextInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 40 },
  noteSendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  noteCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 6 },
  noteContent: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noteMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  activityRow: { flexDirection: "row", gap: 12, paddingBottom: 16 },
  activityLine: { width: 16, alignItems: "center", paddingTop: 4 },
  activityDot: { width: 10, height: 10, borderRadius: 5 },
  activityConnector: { flex: 1, width: 2, marginTop: 4 },
  docCard: { flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 14, gap: 12, alignItems: "center" },
  docIconWrap: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  docInfo: { flex: 1, gap: 3 },
  docName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  docMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  activityContent: { flex: 1, paddingTop: 2, gap: 3 },
  activityAction: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  activityTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptySubText: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", maxWidth: 260 },
  lenderCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  lenderCardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  lenderName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  lenderMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    minWidth: 50,
    alignItems: "center",
  },
  scoreText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  criteriaList: { gap: 5, paddingTop: 4 },
  criteriaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  criteriaText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
});
