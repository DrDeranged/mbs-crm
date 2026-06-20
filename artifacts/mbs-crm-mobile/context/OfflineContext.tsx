import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";

interface QueuedMutation {
  id: string;
  endpoint: string;
  method: string;
  body: unknown;
  timestamp: number;
}

interface OfflineContextValue {
  isOnline: boolean;
  queuedMutations: QueuedMutation[];
  queueMutation: (mutation: Omit<QueuedMutation, "id" | "timestamp">) => Promise<void>;
  clearQueue: () => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  isSyncing: boolean;
  setSyncing: (val: boolean) => void;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  queuedMutations: [],
  queueMutation: async () => {},
  clearQueue: async () => {},
  removeFromQueue: async () => {},
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
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queuedMutations, setQueuedMutations] = useState<QueuedMutation[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      setQueuedMutations(raw ? (JSON.parse(raw) as QueuedMutation[]) : []);
    } catch {
      setQueuedMutations([]);
    }
  }, []);

  const saveQueue = useCallback(async (mutations: QueuedMutation[]) => {
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(mutations));
      setQueuedMutations(mutations);
    } catch {
      // ignore
    }
  }, []);

  const queueMutation = useCallback(
    async (mutation: Omit<QueuedMutation, "id" | "timestamp">) => {
      const entry: QueuedMutation = {
        ...mutation,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
      };
      const current = await AsyncStorage.getItem(QUEUE_KEY);
      const list: QueuedMutation[] = current ? JSON.parse(current) : [];
      await saveQueue([...list, entry]);
    },
    [saveQueue],
  );

  const clearQueue = useCallback(async () => {
    await saveQueue([]);
  }, [saveQueue]);

  const removeFromQueue = useCallback(
    async (id: string) => {
      const current = await AsyncStorage.getItem(QUEUE_KEY);
      const list: QueuedMutation[] = current ? JSON.parse(current) : [];
      await saveQueue(list.filter((m) => m.id !== id));
    },
    [saveQueue],
  );

  const setSyncing = useCallback((val: boolean) => {
    setIsSyncing(val);
  }, []);

  const checkConnectivity = useCallback(async () => {
    const online = await pingServer();
    setIsOnline(online);
  }, []);

  useEffect(() => {
    loadQueue();
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
        queueMutation,
        clearQueue,
        removeFromQueue,
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
