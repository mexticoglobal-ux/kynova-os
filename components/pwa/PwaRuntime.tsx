"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ProductMark } from "@/components/ui/ProductMark";
import { shellText } from "@/lib/i18n/shell-messages";
import { captureInstallPrompt, clearInstallPrompt, isStandalone, registerServiceWorker } from "@/lib/pwa";

const SPLASH_KEY = "kynova_splash";

// Everything the installed app needs at runtime: it registers the service worker (in production only), keeps the install prompt,
// tells the person when the connection drops or returns, and shows the splash screen once per session when it runs installed.
export function PwaRuntime() {
  const { locale } = useI18n();
  const t = shellText(locale);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [splash, setSplash] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") void registerServiceWorker();
    const onPrompt = (event: Event) => captureInstallPrompt(event);
    const onInstalled = () => clearInstallPrompt();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    if (!navigator.onLine) setNotice(t.offline);
    const down = () => {
      setOnline(false);
      setNotice(t.offline);
    };
    const up = () => {
      setOnline(true);
      setNotice(t.online);
      const timer = window.setTimeout(() => setNotice(null), 4000);
      return () => window.clearTimeout(timer);
    };
    window.addEventListener("offline", down);
    window.addEventListener("online", up);
    return () => {
      window.removeEventListener("offline", down);
      window.removeEventListener("online", up);
    };
  }, [t.offline, t.online]);

  useEffect(() => {
    if (!isStandalone()) return;
    try {
      if (window.sessionStorage.getItem(SPLASH_KEY)) return;
      window.sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // storage blocked: the splash simply shows again next time
    }
    setSplash(true);
    const timer = window.setTimeout(() => setSplash(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4">
        {notice && <p className={`card pointer-events-auto animate-pop-in px-4 py-2 text-sm ${online ? "text-success" : "text-warning"}`}>{notice}</p>}
      </div>
      {splash && (
        <div aria-hidden className="fixed inset-0 z-[90] flex animate-fade-up items-center justify-center bg-canvas">
          <ProductMark brand="kynova" size="lg" showTagline />
        </div>
      )}
    </>
  );
}
