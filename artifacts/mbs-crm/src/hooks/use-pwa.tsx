import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { buildIdFromHtml, watchForInstalledUpdate, type ServiceWorkerLike } from '@/lib/serviceWorkerUpdate';

export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const { toast } = useToast();
  const updateAnnounced = useRef(false);

  useEffect(() => {
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let updateListener: (() => void) | undefined;
    let removeControllerListener: (() => void) | undefined;
    const announceUpdate = (worker?: ServiceWorkerLike) => {
      if (disposed || updateAnnounced.current) return;
      updateAnnounced.current = true;
      toast({
        title: "New version available — reload",
        duration: 100000,
        action: (
          <ToastAction
            altText="Reload"
            onClick={() => {
              if (worker) worker.postMessage?.({ type: 'SKIP_WAITING' });
              else window.location.reload();
            }}
          >
            Reload
          </ToastAction>
        ),
      });
    };

    const currentBuild = document.querySelector<HTMLMetaElement>('meta[name="mbs-build-id"]')?.content;
    const checkBuild = async () => {
      if (!currentBuild || disposed) return;
      try {
        const url = new URL(import.meta.env.BASE_URL, window.location.origin);
        const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
        const latest = buildIdFromHtml(await response.text());
        if (latest && latest !== currentBuild) announceUpdate();
      } catch {
        // Offline clients can keep using their installed copy until connectivity returns.
      }
    };
    const buildPoll = window.setInterval(checkBuild, 5 * 60 * 1000);
    void checkBuild();

    if ('serviceWorker' in navigator) {
      // Resolve against the base URL provided by Vite
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      
      navigator.serviceWorker
        .register(swUrl)
        .then((registered) => {
          // Embedded/test browsers may block registration and return no object.
          if (disposed || !registered) return;
          registration = registered;
          updateListener = () => {
            const newWorker = registered.installing;
            if (newWorker) {
              watchForInstalledUpdate(newWorker, () => Boolean(navigator.serviceWorker.controller), (worker) => {
                announceUpdate(worker);
              });
            }
          };
          registration.addEventListener('updatefound', updateListener);
        })
        .catch((err) => console.error('SW reg error:', err));

      const onControllerChange = () => {
        if (disposed) return;
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      };
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      // Keep this listener attached only while the handler is mounted.
      removeControllerListener = () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      disposed = true;
      window.clearInterval(buildPoll);
      if (registration && updateListener) registration.removeEventListener('updatefound', updateListener);
      removeControllerListener?.();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [toast]);

  const promptInstall = useCallback(async () => {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;

    if (isStandalone) {
      toast({ title: "App is already installed" });
      return;
    }

    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsInstallable(false);
      }
    } else if (isIos) {
      toast({
        title: "Install on iOS",
        description: "Share → Add to Home Screen",
        duration: 10000,
      });
    } else {
      toast({
        title: "Installation not supported",
        description: "Your browser does not support installing this app.",
      });
    }
  }, [deferredPrompt, toast]);

  return { isInstallable, promptInstall };
}

export function PwaHandler() {
  const { promptInstall } = usePwa();
  
  useEffect(() => {
    const handler = () => promptInstall();
    window.addEventListener('mbs-prompt-install', handler);
    return () => window.removeEventListener('mbs-prompt-install', handler);
  }, [promptInstall]);

  return null;
}
