import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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

interface TaskCardProps {
  task: Task;
  onComplete?: (taskId: number) => void;
  isCompleting?: boolean;
  showLead?: boolean;
  onLeadPress?: (leadId: number) => void;
}

function formatDueDate(date?: string | null): { label: string; overdue: boolean } {
  if (!date) return { label: "", overdue: false };
  const d = new Date(date);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  const overdue = diff < 0;

  if (overdue) {
    const daysAgo = Math.abs(days);
    return {
      label: daysAgo === 0 ? "Due today" : `${daysAgo}d overdue`,
      overdue: true,
    };
  }
  if (days === 0) return { label: "Due today", overdue: false };
  if (days === 1) return { label: "Due tomorrow", overdue: false };
  if (days < 7) return { label: `Due in ${days}d`, overdue: false };
  return {
    label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    overdue: false,
  };
}

export function TaskCard({ task, onComplete, isCompleting, showLead, onLeadPress }: TaskCardProps) {
  const colors = useColors();
  const isCompleted = !!task.completedAt;
  const { label: dueDateLabel, overdue } = formatDueDate(task.dueDate);

  const handleComplete = async () => {
    if (isCompleted || !onComplete) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onComplete(task.id);
  };

  const handleLeadPress = async () => {
    if (!task.leadId || !onLeadPress) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLeadPress(task.leadId);
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={task.leadId && onLeadPress ? handleLeadPress : undefined}
      activeOpacity={task.leadId && onLeadPress ? 0.7 : 1}
    >
      <TouchableOpacity
        onPress={handleComplete}
        activeOpacity={0.7}
        style={styles.checkbox}
        disabled={isCompleted || !onComplete}
      >
        {isCompleting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : isCompleted ? (
          <View style={[styles.checkboxFilled, { backgroundColor: colors.success }]}>
            <Feather name="check" size={12} color="#fff" />
          </View>
        ) : (
          <View style={[styles.checkboxEmpty, { borderColor: colors.border }]} />
        )}
      </TouchableOpacity>

      <View style={styles.content}>
        <Text
          style={[
            styles.title,
            { color: isCompleted ? colors.mutedForeground : colors.foreground },
            isCompleted && styles.strikethrough,
          ]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        <View style={styles.metaRow}>
          {showLead && task.leadBusinessName && (
            <View style={styles.leadBadgeRow}>
              <Feather name="briefcase" size={11} color={colors.primary} />
              <Text style={[styles.meta, { color: colors.primary }]} numberOfLines={1}>
                {task.leadBusinessName}
              </Text>
            </View>
          )}
          {dueDateLabel ? (
            <Text
              style={[
                styles.meta,
                { color: overdue ? colors.destructive : colors.mutedForeground },
              ]}
            >
              {dueDateLabel}
            </Text>
          ) : null}
        </View>
      </View>

      {task.leadId && onLeadPress && (
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.chevron} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    gap: 12,
  },
  checkbox: {
    marginTop: 2,
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  checkboxFilled: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  strikethrough: {
    textDecorationLine: "line-through",
    opacity: 0.6,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  leadBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  chevron: {
    marginTop: 2,
    alignSelf: "center",
  },
});
