import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfflinePage from "@/app/offline/page";
import { Providers } from "@/components/providers/Providers";
import { clearInstallPrompt } from "@/lib/pwa";
import { InstallButton } from "./InstallButton";
import { PwaRuntime } from "./PwaRuntime";

const runtime = () => (
  <Providers>
    <InstallButton />
    <PwaRuntime />
  </Providers>
);
const standalone = (matches: boolean) => vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList);

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  standalone(false);
});
afterEach(() => {
  vi.useRealTimers();
  clearInstallPrompt();
});

describe("PwaRuntime", () => {
  it("tells the person when the connection drops and when it returns, and then goes quiet", () => {
    render(runtime());
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("Sin conexión: puede ver lo que ya cargó.")).toBeInTheDocument();
    act(() => void window.dispatchEvent(new Event("online")));
    expect(screen.getByText("Conexión restablecida.")).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(4_100));
    expect(screen.queryByText("Conexión restablecida.")).toBeNull();
  });

  it("shows the splash screen once per session, only when it runs installed", () => {
    standalone(true);
    const { container, unmount } = render(runtime());
    expect(container.textContent).toContain("KYNOVA");
    expect(container.querySelector("[aria-hidden='true'].fixed")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(1_000));
    expect(container.querySelector("[aria-hidden='true'].fixed")).toBeNull();
    unmount();
    const again = render(runtime());
    expect(again.container.querySelector("[aria-hidden='true'].fixed")).toBeNull(); // already shown in this session
  });

  it("does not show the splash screen in a browser tab", () => {
    const { container } = render(runtime());
    expect(container.textContent ?? "").not.toContain("KYNOVA");
  });

  it("offers the install button only once the browser says the app can be installed, and opens its prompt", async () => {
    render(runtime());
    expect(screen.queryByRole("button", { name: "Instalar la app" })).toBeNull();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) });
    act(() => void window.dispatchEvent(event));
    const button = screen.getByRole("button", { name: "Instalar la app" });
    await act(async () => void fireEvent.click(button));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Instalar la app" })).toBeNull(); // the offer is used up
  });
});

describe("the offline page", () => {
  it("says what happened and offers to try again", () => {
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reintentar" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByText("KYNOVA")).toBeInTheDocument();
  });
});
