import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";
import { THEME_COLOR } from "@/lib/theme";
import { OFFLINE_URL, SW_URL, canInstall, captureInstallPrompt, clearInstallPrompt, isStandalone, promptInstall, registerServiceWorker, subscribeInstall } from "./pwa";

describe("the installable app", () => {
  it("registers the service worker, and says no when the browser cannot or the registration fails", async () => {
    const register = vi.fn().mockResolvedValue({});
    expect(await registerServiceWorker({ serviceWorker: { register } } as never)).toBe(true);
    expect(register).toHaveBeenCalledWith(SW_URL, { scope: "/" });
    expect(await registerServiceWorker({} as never)).toBe(false);
    expect(await registerServiceWorker({ serviceWorker: { register: vi.fn().mockRejectedValue(new Error("no")) } } as never)).toBe(false);
  });

  it("knows when it runs installed, in its own window", () => {
    const win = (matches: boolean, standalone?: boolean) => ({ navigator: { standalone }, matchMedia: () => ({ matches }) }) as unknown as Window;
    expect(isStandalone(win(true))).toBe(true);
    expect(isStandalone(win(false, true))).toBe(true); // iOS
    expect(isStandalone(win(false))).toBe(false);
  });

  it("keeps the browser's install prompt until the person asks, and opens it once", async () => {
    const seen = vi.fn();
    const stop = subscribeInstall(seen);
    expect(canInstall()).toBe(false);
    expect(await promptInstall()).toBe(false);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    captureInstallPrompt(event);
    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(canInstall()).toBe(false); // the offer is used up
    captureInstallPrompt(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "dismissed" as const }) }));
    expect(await promptInstall()).toBe(false);
    clearInstallPrompt();
    stop();
    const calls = seen.mock.calls.length;
    clearInstallPrompt();
    expect(seen.mock.calls.length).toBe(calls); // unsubscribed
  });

  it("is installable: standalone, with icons (one maskable), shortcuts and the NOVA Dark colors for the splash screen", () => {
    const data = manifest();
    expect(data).toMatchObject({ id: "/", display: "standalone", scope: "/", lang: "es", background_color: THEME_COLOR["nova-dark"], theme_color: THEME_COLOR["nova-dark"] });
    expect(data.start_url).toContain("/dashboard");
    expect(data.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(data.icons?.some((icon) => icon.purpose === "any")).toBe(true);
    expect(data.shortcuts?.map((item) => item.name)).toEqual(["Panel", "NEX", "Plataforma"]);
    for (const icon of data.icons ?? []) expect(icon.src.startsWith("/")).toBe(true);
  });
});

// The service worker runs in a browser, so it is exercised here in a sandbox with a fake cache and a fake network.
function loadWorker(network: (url: string) => Promise<{ ok: boolean; type: string; clone: () => unknown }>) {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  const cached = new Map<string, unknown>();
  const puts: string[] = [];
  const deleted: string[] = [];
  const added: string[][] = [];
  const cache = {
    addAll: async (urls: string[]) => { added.push(urls); },
    match: async (request: { url?: string } | string) => cached.get(typeof request === "string" ? request : request.url ?? ""),
    put: async (request: { url: string }) => { puts.push(request.url); },
  };
  const caches = {
    open: async () => cache,
    match: async (url: string) => (url === OFFLINE_URL ? "OFFLINE PAGE" : undefined),
    keys: async () => ["kynova-v1-static", "kynova-v2-static"],
    delete: async (name: string) => { deleted.push(name); return true; },
  };
  const self = {
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) => { handlers[type] = handler; },
    location: { origin: "https://kynova.test" },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
  };
  runInNewContext(readFileSync(join(process.cwd(), "public", "sw.js"), "utf8"), { self, caches, fetch: (request: { url: string }) => network(request.url), URL, Promise, Array });
  const fetchEvent = (url: string, init: { method?: string; mode?: string } = {}) => {
    const respondWith = vi.fn();
    handlers["fetch"]?.({ request: { url, method: init.method ?? "GET", mode: init.mode ?? "no-cors" }, respondWith });
    return respondWith;
  };
  return { handlers, self, fetchEvent, puts, deleted, added, cached };
}
const ok = () => Promise.resolve({ ok: true, type: "basic", clone: () => "COPY" });

describe("the service worker", () => {
  it("precaches only the offline page and the icons, and drops caches of older versions", async () => {
    const worker = loadWorker(ok);
    const waits: Promise<unknown>[] = [];
    worker.handlers["install"]?.({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect(worker.added[0]).toEqual([OFFLINE_URL, "/icon.svg", "/apple-icon.png"]);
    expect(worker.self.skipWaiting).toHaveBeenCalled();
    const more: Promise<unknown>[] = [];
    worker.handlers["activate"]?.({ waitUntil: (p: Promise<unknown>) => more.push(p) });
    await Promise.all(more);
    expect(worker.deleted).toEqual(["kynova-v1-static"]);
    expect(worker.self.clients.claim).toHaveBeenCalled();
  });

  it("never touches an API call, a sign-in, a write or another site", () => {
    const worker = loadWorker(ok);
    expect(worker.fetchEvent("https://kynova.test/api/v1/leads").mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://kynova.test/api/profile").mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://kynova.test/login", { mode: "navigate" }).mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://kynova.test/auth/callback", { mode: "navigate" }).mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://kynova.test/dashboard", { method: "POST" }).mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://cdn.example/_next/static/a.js").mock.calls).toHaveLength(0);
    expect(worker.fetchEvent("https://kynova.test/dashboard.json").mock.calls).toHaveLength(0); // not a static file
  });

  it("sends a page to the network, shows the offline page only when it fails, and never stores a page", async () => {
    const online = loadWorker(ok);
    const respond = online.fetchEvent("https://kynova.test/dashboard", { mode: "navigate" });
    expect(respond).toHaveBeenCalledTimes(1);
    await respond.mock.calls[0]?.[0];
    expect(online.puts).toEqual([]); // a signed-in page never reaches the cache
    const offline = loadWorker(() => Promise.reject(new Error("offline")));
    const fallback = offline.fetchEvent("https://kynova.test/platform/billing", { mode: "navigate" });
    expect(await fallback.mock.calls[0]?.[0]).toBe("OFFLINE PAGE");
  });

  it("keeps static files at hand: from the cache at once, refreshed in the background", async () => {
    const worker = loadWorker(ok);
    const url = "https://kynova.test/_next/static/chunks/app.js";
    const first = worker.fetchEvent(url);
    await first.mock.calls[0]?.[0];
    expect(worker.puts).toEqual([url]);
    worker.cached.set(url, "CACHED FILE");
    const second = worker.fetchEvent(url);
    expect(await second.mock.calls[0]?.[0]).toBe("CACHED FILE");
    expect(worker.fetchEvent("https://kynova.test/icon.svg").mock.calls).toHaveLength(1);
  });
});
