import { useGetMyTasks, useUpdateTask } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TaskCard } from "@/components/TaskCard";
import { useColors } from "@/hooks/useColors";

interface Task {
  id: number;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
  leadId?: number | null;
  leadBusinessName?: string | null;
  assignedToName?: string | null;
}

interface Section {
  title: string;
  accent: string;
  data: Task[];
}

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());

  const { data, isLoading, refetch, isFetching } = useGetMyTasks();
  const { mutateAsync: updateTask } = useUpdateTask();

  const handleComplete = useCallback(
    async (taskId: number) => {
      setCompletingIds((prev) => new Set(prev).add(taskId));
      try {
        await updateTask({
          taskId,
          data: { isCompleted: true },
        });
        refetch();
      } finally {
        setCompletingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [updateTask, refetch],
  );

  const sections: Section[] = [
    {
      title: "Overdue",
      accent: colors.destructive,
      data: ((data as { overdue?: Task[] } | undefined)?.overdue ?? []).filter((t) => !t.completedAt),
    },
    {
      title: "Today",
      accent: colors.warning,
      data: ((data as { dueToday?: Task[] } | undefined)?.dueToday ?? []).filter((t) => !t.completedAt),
    },
    {
      title: "This Week",
      accent: colors.primary,
      data: ((data as { dueThisWeek?: Task[] } | undefined)?.dueThisWeek ?? []).filter((t) => !t.completedAt),
    },
  ].filter((s) => s.data.length > 0);

  const totalTasks = sections.reduce((acc, s) => acc + s.data.length, 0);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Tasks</Text>
          {totalTasks > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>{totalTasks}</Text>
            </View>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="check-circle" size={44} color={colors.success} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All caught up!</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No pending tasks. Great work!
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              onComplete={handleComplete}
              isCompleting={completingIds.has(item.id)}
              showLead
              onLeadPress={(leadId) => router.push(`/lead/${leadId}`)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
              <View style={[styles.sectionAccent, { backgroundColor: (section as Section).accent }]} />
              <Text style={[styles.sectionTitle, { color: (section as Section).accent }]}>
                {section.title}
              </Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
                {section.data.length}
              </Text>
            </View>
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 90 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  list: { paddingTop: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 8,
  },
  sectionAccent: {
    width: 3,
    height: 16,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
