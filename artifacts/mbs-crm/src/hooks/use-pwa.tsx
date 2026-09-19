import React, { useEffect, useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { SERVICE_WORKER_VERSION, watchForInstalledUpdate } from '@/lib/serviceWorkerUpdate';

export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Resolve against the base URL provided by Vite
      const swUrl = `${import.meta.env.BASE_URL}sw.js?v=${SERVICE_WORKER_VERSION}`;
      const hadControllerBeforeRegistration = Boolean(navigator.serviceWorker.controller);
      
      navigator.serviceWorker
        .register(swUrl)
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              watchForInstalledUpdate(newWorker, () => Boolean(navigator.serviceWorker.controller), (worker) => {
                toast({
                  title: "New version available — reload",
                  duration: 100000,
                  action: (
                    <ToastAction
                      altText="Reload"
                      onClick={() => {
                        worker.postMessage?.({ type: 'SKIP_WAITING' });
                      }}
                    >
                      Reload
                    </ToastAction>
                  ),
                });
              });
            }
          });
        })
        .catch((err) => console.error('SW reg error:', err));

      if (hadControllerBeforeRegistration) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });
      }
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
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
