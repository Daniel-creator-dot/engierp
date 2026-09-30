import { useEffect } from 'react';
import { toast } from 'sonner';

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * A long-open tab keeps running the bundle it first loaded. Compare the build id baked into this
 * bundle with the deployed version.json and offer a reload when they differ.
 */
export function useVersionCheck() {
  useEffect(() => {
    if (!(import.meta as any).env?.PROD) return;
    let notified = false;

    const check = async () => {
      if (notified || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (version && version !== __APP_VERSION__) {
          notified = true;
          toast('A new version of the app is available', {
            description: 'Reload to get the latest features and fixes.',
            duration: Infinity,
            action: { label: 'Reload', onClick: () => window.location.reload() },
          });
        }
      } catch {
        // Offline or mid-deploy; try again on the next tick.
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}
