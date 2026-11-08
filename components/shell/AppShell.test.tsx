import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { NAV_MEMORY_KEY } from "@/lib/nav-memory";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { AppShell } from "./AppShell";

const mocks = vi.hoisted(() => ({ path: "/dashboard", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => ({ push: mocks.push }) }));

const shell = () => (
  <Providers>
    <AppShell>
      <p>Contenido de la página</p>
    </AppShell>
  </Providers>
);
const stored = () => JSON.parse(window.localStorage.getItem(NAV_MEMORY_KEY) ?? "{}") as { favorites?: string[]; recents?: string[]; collapsed?: boolean };

beforeEach(() => {
  mocks.path = "/dashboard";
  mocks.push.mockClear();
  window.localStorage.clear();
  document.documentElement.setAttribute("data-theme", "nova-dark");
});
afterEach(() => window.localStorage.clear());

describe("AppShell", () => {
  it("lets a keyboard user skip the navigation and lands on the main landmark", () => {
    render(shell());
    const skip = screen.getByRole("link", { name: "Saltar al contenido" });
    expect(skip).toHaveAttribute("href", "#contenido");
    expect(skip).toHaveClass("skip-link");
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "contenido");
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(within(main).getByText("Contenido de la página")).toBeInTheDocument();
  });

  it("marks the current screen in the navigation", () => {
    mocks.path = "/platform/crm";
    render(shell());
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    const hrefs = current.map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/platform"); // a platform screen keeps its module lit
    expect(hrefs.every((href) => href === "/platform" || href === "/platform/crm")).toBe(true);
  });

  it("collapses the sidebar to icons and remembers it", async () => {
    const { unmount } = render(shell());
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveClass("w-64");
    fireEvent.click(screen.getByRole("button", { name: "Contraer la barra lateral" }));
    expect(aside).toHaveClass("w-[4.75rem]");
    expect(screen.getByRole("button", { name: "Expandir la barra lateral" })).toBeInTheDocument();
    expect(within(aside).queryByRole("button", { name: /favoritos/ })).toBeNull(); // icons only: no stars
    await waitFor(() => expect(stored().collapsed).toBe(true));
    unmount();
    render(shell());
    await waitFor(() => expect(screen.getByRole("complementary")).toHaveClass("w-[4.75rem]"));
    fireEvent.click(screen.getByRole("button", { name: "Expandir la barra lateral" }));
    await waitFor(() => expect(stored().collapsed).toBe(false));
  });

  it("pins a screen as a favorite, lists it first, and lets it go", async () => {
    render(shell());
    expect(screen.queryByRole("region", { name: "Favoritos" })).toBeNull();
    const aside = within(screen.getByRole("complementary"));
    const star = aside.getAllByRole("button", { name: /^Añadir .* a favoritos$/ })[1] as HTMLElement; // the second module
    const name = /^Añadir (.*) a favoritos$/.exec(star.getAttribute("aria-label") ?? "")?.[1] ?? "";
    fireEvent.click(star);
    const favorites = within(await screen.findByRole("region", { name: "Favoritos" }));
    expect(favorites.getByRole("link", { name })).toBeInTheDocument();
    expect(aside.getByRole("button", { name: `Quitar ${name} de favoritos` })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(stored().favorites).toHaveLength(1));
    fireEvent.click(aside.getByRole("button", { name: `Quitar ${name} de favoritos` }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Favoritos" })).toBeNull());
    expect(stored().favorites).toEqual([]);
  });

  it("remembers the screens opened, and shows them as recent", async () => {
    window.localStorage.setItem(NAV_MEMORY_KEY, JSON.stringify({ favorites: [], recents: ["/sales", "/nex"], collapsed: false }));
    mocks.path = "/platform/billing";
    render(shell());
    const recents = within(await screen.findByRole("region", { name: "Recientes" }));
    expect(recents.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/platform/billing", "/sales", "/nex"]);
    expect(recents.getByRole("link", { name: "Facturación y suscripciones" })).toBeInTheDocument(); // a platform screen has its own name
    await waitFor(() => expect(stored().recents?.[0]).toBe("/platform/billing"));
  });

  it("opens the quick search with Ctrl K, finds a screen without caring about accents, and opens it with Enter", async () => {
    render(shell());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Búsqueda rápida" });
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "facturacion" } });
    const options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Facturación y suscripciones");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/platform/billing");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves through the results with the arrows, says when there are none, and closes with Escape", async () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    const dialog = await screen.findByRole("dialog", { name: "Búsqueda rápida" });
    const input = within(dialog).getByRole("combobox");
    fireEvent.change(input, { target: { value: "inteligen" } });
    const count = within(dialog).getAllByRole("option").length;
    expect(count).toBeGreaterThan(1);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(dialog).getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(within(dialog).getAllByRole("option")[count - 1]).toHaveAttribute("aria-selected", "true"); // wraps
    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(within(dialog).getByText("No hay resultados.")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("switches between NOVA Dark and NOVA Light and remembers the choice", () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a NOVA Light" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("nova-light");
    fireEvent.click(screen.getByRole("button", { name: "Cambiar a NOVA Dark" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-dark");
  });

  it("opens the phone menu as a drawer with the same navigation and closes it", async () => {
    render(shell());
    fireEvent.click(screen.getByRole("button", { name: /abrir|open/i }));
    const drawers = screen.getAllByRole("navigation");
    expect(drawers.length).toBeGreaterThanOrEqual(2);
    await act(async () => undefined);
    fireEvent.click(screen.getAllByRole("button", { name: /cerrar|close/i })[0] as HTMLElement);
  });
});
