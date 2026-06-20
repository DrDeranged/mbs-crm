import { useGetDashboardSummary, useGetMyTasks, useGetMe } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeadCard } from "@/components/LeadCard";
import { StatusBadge } from "@/components/StatusBadge";
import { useColors } from "@/hooks/useColors";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  accent: string;
  colors: ReturnType<typeof useColors>;
}

function StatCard({ label, value, icon, accent, colors }: StatCardProps) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: accent + "20" }]}>
        <Feather name={icon as keyof typeof Feather.glyphMap} size={18} color={accent} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function PipelineBar({
  label,
  count,
  total,
  status,
  colors,
}: {
  label: string;
  count: number;
  total: number;
  status: string;
  colors: ReturnType<typeof useColors>;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={styles.pipelineRow}>
      <View style={styles.pipelineLeft}>
        <StatusBadge status={status} small />
        <Text style={[styles.pipelineCount, { color: colors.mutedForeground }]}>{count}</Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
        <View
          style={[styles.barFill, { width: `${pct}%` as `${number}%`, backgroundColor: colors.primary }]}
        />
      </View>
    </View>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: me } = useGetMe();
  const {
    data: summary,
    isLoading,
    refetch: refetchSummary,
    isFetching: isFetchingSummary,
  } = useGetDashboardSummary();
  const { data: myTasks, refetch: refetchTasks } = useGetMyTasks();

  const meData = me as { name?: string | null } | undefined;
  const firstName = meData?.name?.split(" ")[0] ?? "there";

  const summaryData = summary as {
    totalLeads?: number;
    applications?: number;
    approvals?: number;
    fundings?: number;
    recentLeads?: Array<{
      id: number;
      businessName?: string | null;
      ownerFirstName?: string | null;
      ownerLastName?: string | null;
      status: string;
      loanAmountRequested?: number | null;
      createdAt?: string | null;
    }>;
    pipelineByStage?: Record<string, number>;
  } | undefined;

  const tasksData = myTasks as {
    dueToday?: Array<{ id: number; title: string; dueDate?: string | null; completedAt?: string | null; leadBusinessName?: string | null }>;
    overdue?: Array<{ id: number; title: string; dueDate?: string | null; completedAt?: string | null; leadBusinessName?: string | null }>;
  } | undefined;

  const todayTasks = [...(tasksData?.overdue ?? []), ...(tasksData?.dueToday ?? [])].filter(
    (t) => !t.completedAt,
  );

  const pipeline = summaryData?.pipelineByStage ?? {};
  const pipelineTotal = Object.values(pipeline).reduce((a, b) => a + b, 0);

  const handleRefresh = () => {
    refetchSummary();
    refetchTasks();
  };

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 12, paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 90 },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetchingSummary}
          onRefresh={handleRefresh}
          tintColor={colors.primary}
        />
      }
    >
      <View style={styles.greeting}>
        <Text style={[styles.greetingLine, { color: colors.mutedForeground }]}>
          {getGreeting()},
        </Text>
        <Text style={[styles.greetingName, { color: colors.foreground }]}>{firstName}</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={styles.statsGrid}>
            <StatCard
              label="Total Leads"
              value={summaryData?.totalLeads ?? 0}
              icon="users"
              accent={colors.primary}
              colors={colors}
            />
            <StatCard
              label="Applications"
              value={summaryData?.applications ?? 0}
              icon="file-text"
              accent={colors.accent}
              colors={colors}
            />
            <StatCard
              label="Approved"
              value={summaryData?.approvals ?? 0}
              icon="check-circle"
              accent={colors.success}
              colors={colors}
            />
            <StatCard
              label="Funded"
              value={summaryData?.fundings ?? 0}
              icon="dollar-sign"
              accent={colors.warning}
              colors={colors}
            />
          </View>

          {pipelineTotal > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Pipeline</Text>
              <View style={styles.pipelineList}>
                {Object.entries(pipeline)
                  .sort(([, a], [, b]) => b - a)
                  .map(([status, count]) => (
                    <PipelineBar
                      key={status}
                      label={status}
                      status={status}
                      count={count}
                      total={pipelineTotal}
                      colors={colors}
                    />
                  ))}
              </View>
            </View>
          )}

          {todayTasks.length > 0 && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Tasks Due</Text>
                <TouchableOpacity onPress={() => router.push("/(tabs)/tasks")}>
                  <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.taskList}>
                {todayTasks.slice(0, 5).map((t) => (
                  <View
                    key={t.id}
                    style={[styles.taskRow, { borderBottomColor: colors.border }]}
                  >
                    <View style={[styles.taskDot, { backgroundColor: colors.primary }]} />
                    <View style={styles.taskInfo}>
                      <Text
                        style={[styles.taskTitle, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {t.title}
                      </Text>
                      {t.leadBusinessName && (
                        <Text
                          style={[styles.taskMeta, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {t.leadBusinessName}
                        </Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {(summaryData?.recentLeads?.length ?? 0) > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Recent Leads</Text>
                <TouchableOpacity onPress={() => router.push("/(tabs)/leads")}>
                  <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
                </TouchableOpacity>
              </View>
              {summaryData!.recentLeads!.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  greeting: { gap: 2 },
  greetingLine: { fontSize: 14, fontFamily: "Inter_400Regular" },
  greetingName: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: "45%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  seeAll: { fontSize: 14, fontFamily: "Inter_500Medium" },
  pipelineList: { gap: 10 },
  pipelineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pipelineLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: 130,
  },
  pipelineCount: { fontSize: 12, fontFamily: "Inter_500Medium" },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  taskList: { gap: 0 },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 10,
  },
  taskDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  taskInfo: { flex: 1 },
  taskTitle: { fontSize: 14, fontFamily: "Inter_500Medium" },
  taskMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  recentSection: { gap: 8 },
});
