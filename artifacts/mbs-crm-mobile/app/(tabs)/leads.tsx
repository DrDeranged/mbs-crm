import AsyncStorage from "@react-native-async-storage/async-storage";
import { useListLeads, useGetMe } from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeadCard } from "@/components/LeadCard";
import { useColors } from "@/hooks/useColors";

const CACHE_KEY = "@mbs_leads_cache";

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "New Lead", value: "new_lead" },
  { label: "Contacted", value: "contacted" },
  { label: "App Received", value: "application_received" },
  { label: "Submitted", value: "submitted_to_underwriting" },
  { label: "Approved", value: "approved" },
  { label: "Funded", value: "funded" },
  { label: "Follow Up", value: "follow_up" },
  { label: "Declined", value: "declined" },
] as const;

type LeadRecord = {
  id: number;
  businessName?: string | null;
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
  phone?: string | null;
  status: string;
  loanAmountRequested?: number | null;
  createdAt?: string | null;
};

export default function LeadsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [myLeadsOnly, setMyLeadsOnly] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [allLeads, setAllLeads] = useState<LeadRecord[]>([]);
  const [cachedLeads, setCachedLeads] = useState<LeadRecord[]>([]);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: me } = useGetMe();

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      setAllLeads([]);
    }, 350);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [search]);

  useEffect(() => {
    setPage(1);
    setAllLeads([]);
  }, [statusFilter, myLeadsOnly]);

  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (raw) setCachedLeads(JSON.parse(raw) as LeadRecord[]);
    });
  }, []);

  const { data, isLoading, isFetching, refetch, isError } = useListLeads({
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    repId: myLeadsOnly && me ? (me as { id: number }).id : undefined,
    page,
    limit: 25,
  });

  useEffect(() => {
    if (data?.leads) {
      const newLeads = data.leads as LeadRecord[];
      if (page === 1) {
        setAllLeads(newLeads);
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(newLeads));
      } else {
        setAllLeads((prev) => {
          const ids = new Set(prev.map((l) => l.id));
          return [...prev, ...newLeads.filter((l) => !ids.has(l.id))];
        });
      }
    }
  }, [data, page]);

  const displayLeads = isError && allLeads.length === 0 ? cachedLeads : allLeads;

  const loadMore = useCallback(() => {
    if (!isFetching && data?.totalPages && page < data.totalPages) {
      setPage((p) => p + 1);
    }
  }, [isFetching, data, page]);

  const handleRefresh = useCallback(() => {
    setPage(1);
    setAllLeads([]);
    refetch();
  }, [refetch]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Leads</Text>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/new-lead")}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search leads..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.filtersRow}>
        <FlatList
          horizontal
          data={STATUS_FILTERS}
          keyExtractor={(item) => item.value}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filtersList}
          ListHeaderComponent={
            <TouchableOpacity
              onPress={() => setMyLeadsOnly((v) => !v)}
              style={[
                styles.filterChip,
                styles.myLeadsChip,
                {
                  backgroundColor: myLeadsOnly ? colors.primary : colors.card,
                  borderColor: myLeadsOnly ? colors.primary : colors.border,
                },
              ]}
            >
              <Feather name="user" size={11} color={myLeadsOnly ? "#fff" : colors.mutedForeground} />
              <Text
                style={[
                  styles.filterChipText,
                  { color: myLeadsOnly ? "#fff" : colors.mutedForeground },
                ]}
              >
                My Leads
              </Text>
            </TouchableOpacity>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setStatusFilter(item.value)}
              style={[
                styles.filterChip,
                {
                  backgroundColor:
                    statusFilter === item.value ? colors.primary : colors.card,
                  borderColor:
                    statusFilter === item.value ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color:
                      statusFilter === item.value ? "#fff" : colors.mutedForeground,
                  },
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {isLoading && page === 1 ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : displayLeads.length === 0 && !isFetching ? (
        <View style={styles.emptyState}>
          <Feather name="users" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {search || statusFilter || myLeadsOnly ? "No matching leads" : "No leads yet"}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {search || statusFilter || myLeadsOnly
              ? "Try adjusting your search or filters"
              : "Add your first lead to get started"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayLeads}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <LeadCard lead={item} />}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 90 },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && page === 1}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            isFetching && page > 1 ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  filtersRow: {
    marginBottom: 8,
  },
  filtersList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
  },
  myLeadsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  list: {
    paddingTop: 8,
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
    lineHeight: 20,
  },
});
