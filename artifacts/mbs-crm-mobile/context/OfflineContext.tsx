import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@clerk/clerk-expo";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import { bindQueueMutationToOwner } from "@/context/queueSecurity";

export interface QueuedMutation {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  timestamp: number;
  ownerUserId?: string;
  blockedReason?: "legacy_unowned" | "different_user";
}

type NewQueuedMutation = Omit<
  QueuedMutation,
  "id" | "timestamp" | "ownerUserId" | "blockedReason"
>;

interface OfflineContextValue {
  isOnline: boolean;
  queuedMutations: QueuedMutation[];
  isQueueLoaded: boolean;
  queueMutation: (mutation: NewQueuedMutation) => Promise<void>;
  clearQueue: () => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  setMutationBlocked: (
    id: string,
    reason: QueuedMutation["blockedReason"] | null,
  ) => Promise<boolean>;
  isSyncing: boolean;
  setSyncing: (val: boolean) => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  queuedMutations: [],
  isQueueLoaded: false,
  queueMutation: async () => {},
  clearQueue: async () => {},
  removeFromQueue: async () => {},
  setMutationBlocked: async () => false,
  isSyncing: false,
  setSyncing: () => {},
});

const QUEUE_KEY = "@mbs_sync_queue";

async function pingServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/healthz`,
      { signal: controller.signal, method: "HEAD" },
    );
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queuedMutations, setQueuedMutations] = useState<QueuedMutation[]>([]);
  const [isQueueLoaded, setIsQueueLoaded] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queueRef = useRef<QueuedMutation[]>([]);
  const queueLoadedRef = useRef(false);
  const queueOperationsRef = useRef<Promise<void>>(Promise.resolve());

  const serializeQueueOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queueOperationsRef.current.then(operation);
    queueOperationsRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  const readQueue = useCallback(async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMutation[]) : [];
  }, []);

  const loadQueue = useCallback(
    () =>
      serializeQueueOperation(async () => {
        const list = await readQueue();
        queueRef.current = list;
        queueLoadedRef.current = true;
        setQueuedMutations(list);
        setIsQueueLoaded(true);
      }),
    [readQueue, serializeQueueOperation],
  );

  const saveQueue = useCallback(
    async (mutations: QueuedMutation[]) => {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(mutations));
      queueRef.current = mutations;
      setQueuedMutations(mutations);
    },
    [],
  );

  const queueMutation = useCallback(
    (mutation: NewQueuedMutation) =>
      serializeQueueOperation(async () => {
        if (!userId) {
          throw new Error("Sign in before saving an offline change.");
        }
        if (!queueLoadedRef.current) {
          const existing = await readQueue();
          queueRef.current = existing;
          queueLoadedRef.current = true;
          setQueuedMutations(existing);
          setIsQueueLoaded(true);
        }
        const entry: QueuedMutation = {
          ...bindQueueMutationToOwner(mutation, userId),
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
        };
        await saveQueue([...queueRef.current, entry]);
      }),
    [readQueue, saveQueue, serializeQueueOperation, userId],
  );

  const clearQueue = useCallback(async () => {
    await serializeQueueOperation(() => saveQueue([]));
  }, [saveQueue, serializeQueueOperation]);

  const removeFromQueue = useCallback(
    (id: string) =>
      serializeQueueOperation(() =>
        saveQueue(queueRef.current.filter((mutation) => mutation.id !== id)),
      ),
    [saveQueue, serializeQueueOperation],
  );

  const setMutationBlocked = useCallback(
    (id: string, reason: QueuedMutation["blockedReason"] | null) =>
      serializeQueueOperation(async () => {
        const current = queueRef.current.find((mutation) => mutation.id === id);
        if (!current || current.blockedReason === (reason ?? undefined)) return false;
        const updated = queueRef.current.map((mutation) => {
          if (mutation.id !== id) return mutation;
          const { blockedReason: _previousReason, ...entry } = mutation;
          return reason ? { ...entry, blockedReason: reason } : entry;
        });
        await saveQueue(updated);
        return true;
      }),
    [saveQueue, serializeQueueOperation],
  );

  const setSyncing = useCallback((val: boolean) => {
    setIsSyncing(val);
  }, []);

  const checkConnectivity = useCallback(async () => {
    const online = await pingServer();
    setIsOnline(online);
  }, []);

  useEffect(() => {
    loadQueue().catch((error: unknown) => {
      console.warn("Unable to load the offline sync queue.", error);
    });
    checkConnectivity();
    checkIntervalRef.current = setInterval(checkConnectivity, 15000);
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") checkConnectivity();
    });
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      sub.remove();
    };
  }, [checkConnectivity, loadQueue]);

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        queuedMutations,
        isQueueLoaded,
        queueMutation,
        clearQueue,
        removeFromQueue,
        setMutationBlocked,
        isSyncing,
        setSyncing,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  return useContext(OfflineContext);
}
