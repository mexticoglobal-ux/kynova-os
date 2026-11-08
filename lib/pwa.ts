// The installable app (PWA): registering the service worker and the install prompt. Nothing here touches business data:
// the service worker (public/sw.js) only caches static files and shows an offline page, never a signed-in screen or an API answer.
export const SW_URL = "/sw.js";
export const OFFLINE_URL = "/offline";

export async function registerServiceWorker(nav: Pick<Navigator, "serviceWorker"> | { serviceWorker?: undefined } = navigator): Promise<boolean> {
  if (!nav.serviceWorker) return false;
  try {
    await nav.serviceWorker.register(SW_URL, { scope: "/" });
    return true;
  } catch {
    return false;
  }
}

/** True when the app runs installed (its own window), not in a browser tab. */
export function isStandalone(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return win.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

// The browser offers to install the app once; the prompt is kept until the person asks for it.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function captureInstallPrompt(event: Event): void {
  event.preventDefault();
  deferred = event as InstallEvent;
  notify();
}
export function clearInstallPrompt(): void {
  deferred = null;
  notify();
}
export const canInstall = (): boolean => deferred !== null;
export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
/** Opens the browser's install dialog. Resolves true when the person accepts. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  await event.prompt();
  const choice = await event.userChoice;
  clearInstallPrompt();
  return choice.outcome === "accepted";
}
