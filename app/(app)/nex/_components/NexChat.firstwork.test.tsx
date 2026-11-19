import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { PipelineProvider } from "@/components/pipeline/PipelineProvider";
import { es } from "@/lib/i18n/messages/es";
import { DRAFT_MARK } from "@/lib/first-work";
import { NexChat } from "./NexChat";

vi.mock("@/lib/nex", () => ({ askNex: vi.fn() }));

const KEY = "kynova.nex.conversations";
const conversation = (id: string, title: string, text: string) => ({ id, title, updatedAt: 1, messages: [{ role: "nex", text }] });

function renderChat() {
  return render(
    <Providers>
      <PipelineProvider seed>
        <NexChat />
      </PipelineProvider>
    </Providers>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("NexChat · first work", () => {
  it("shows each saved draft under its kind, also drafts saved earlier with a generic title", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        conversation("a", "Borrador: primera prioridad", `${DRAFT_MARK}Propuesta de mensaje y presentación\nresto`),
        conversation("b", "Borrador: primera prioridad", `${DRAFT_MARK}Seguimiento preparado\nresto`),
        conversation("c", "Una consulta", "Hola"),
      ]),
    );
    renderChat();
    expect(screen.getByText("Captación: mensaje y presentación")).toBeTruthy();
    expect(screen.getByText("Seguimiento: prospectos")).toBeTruthy();
    expect(screen.getByText("Una consulta")).toBeTruthy();
    expect(screen.queryByText("Borrador: primera prioridad")).toBeNull();
  });

  it("New conversation goes back to the top of the panel", () => {
    renderChat();
    const panel = document.querySelector("[data-nex-scroll]") as HTMLElement;
    panel.scrollTop = 240;
    fireEvent.click(screen.getAllByRole("button", { name: es.nex.newChat })[0] as HTMLElement);
    expect(panel.scrollTop).toBe(0);
  });
});
