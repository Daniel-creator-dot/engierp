import { useEffect } from 'react';
import { toast } from 'sonner';

const CHECK_EVERY_MS = 5 * 60 * 1000;

const currentBundle = () =>
  document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') || '';

/**
 * A long-open tab keeps running the bundle it first loaded. Fetch the page a reload would get and
 * offer a reload once it points at a different bundle. Checking the page itself (rather than a
 * separate version file) avoids prompting while the host still serves the previous index.html.
 */
export function useVersionCheck() {
  useEffect(() => {
    const running = currentBundle();
    if (!(import.meta as any).env?.PROD || !running.includes('/assets/')) return;
    let notified = false;

    const check = async () => {
      if (notified || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`${window.location.pathname}?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const deployed = (await res.text()).match(/\/assets\/[^"']+\.js/)?.[0];
        if (deployed && !running.endsWith(deployed)) {
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
