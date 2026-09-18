import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/lib/apiBase";
import { useToast } from "@/hooks/use-toast";

export type NotificationEvents = {
  new_application: boolean;
  new_lead_assigned: boolean;
  lead_replied: boolean;
  submission_status_changed: boolean;
  task_due: boolean;
  stale_lead: boolean;
};

export type NotificationPreferences = {
  pushEnabled: boolean;
  events: NotificationEvents;
};

type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

type VapidPublicKeyResponse = {
  publicKey: string;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useNotificationSettings() {
  const apiBase = getApiBaseUrl();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const getPreferencesQuery = useQuery<NotificationPreferences, Error>({
    queryKey: ["notificationPreferences"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/notifications/preferences`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: Partial<NotificationPreferences>) => {
      const res = await fetch(`${apiBase}/notifications/preferences`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update preferences");
      return res.json() as Promise<NotificationPreferences>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["notificationPreferences"], data);
      toast({ title: "Preferences updated", description: "Notification settings have been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update notification settings.", variant: "destructive" });
    },
  });

  const upsertSubscription = async (sub: PushSubscriptionInput) => {
    const res = await fetch(`${apiBase}/notifications/subscriptions`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
    if (!res.ok) throw new Error("Failed to register subscription");
  };

  const removeSubscription = async (endpoint: string) => {
    const res = await fetch(`${apiBase}/notifications/subscriptions`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) throw new Error("Failed to remove subscription");
  };

  const [isPushToggling, setIsPushToggling] = useState(false);

  const togglePushMaster = useCallback(
    async (enable: boolean) => {
      setIsPushToggling(true);
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          toast({ title: "Unsupported", description: "Push notifications are not supported by your browser.", variant: "destructive" });
          return;
        }

        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (enable) {
          const perm = await Notification.requestPermission();
          if (perm !== "granted") {
            toast({ title: "Permission Denied", description: "Please allow notifications in your browser settings.", variant: "destructive" });
            return;
          }

          if (!subscription) {
            const vapidRes = await fetch(`${apiBase}/notifications/vapid-public-key`, { credentials: "include" });
            if (!vapidRes.ok) throw new Error("Could not fetch VAPID key");
            const vapidData: VapidPublicKeyResponse = await vapidRes.json();

            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
            });
          }

          const p256dh = subscription.getKey("p256dh");
          const auth = subscription.getKey("auth");
          if (!p256dh || !auth) throw new Error("Keys missing from subscription");

          await upsertSubscription({
            endpoint: subscription.endpoint,
            p256dh: arrayBufferToBase64(p256dh),
            auth: arrayBufferToBase64(auth),
            userAgent: navigator.userAgent,
          });

          await updatePreferencesMutation.mutateAsync({ pushEnabled: true });
        } else {
          if (subscription) {
            await removeSubscription(subscription.endpoint);
            await subscription.unsubscribe();
          }
          await updatePreferencesMutation.mutateAsync({ pushEnabled: false });
        }
      } catch (err) {
        console.error(err);
        toast({ title: "Error", description: "Failed to update master push toggle.", variant: "destructive" });
      } finally {
        setIsPushToggling(false);
      }
    },
    [apiBase, updatePreferencesMutation, toast]
  );

  return {
    preferences: getPreferencesQuery.data,
    isLoading: getPreferencesQuery.isLoading,
    isError: getPreferencesQuery.isError,
    updatePreferences: updatePreferencesMutation.mutate,
    isUpdating: updatePreferencesMutation.isPending || isPushToggling,
    togglePushMaster,
  };
}
