import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { PipelineProvider } from "@/components/pipeline/PipelineProvider";
import { NexDashboard } from "../../dashboard/_components/NexDashboard";
import { PipelineBoard } from "../../sales/_components/PipelineBoard";
import { ConnectedGuidedChat } from "./ConnectedGuidedChat";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

// The three screens share one pipeline, as they do inside the app layout.
function Everything() {
  return (
    <Providers>
      <PipelineProvider>
        <ConnectedGuidedChat paceMs={0} />
        <NexDashboard />
        <PipelineBoard />
      </PipelineProvider>
    </Providers>
  );
}

const click = async (name: string | RegExp) => fireEvent.click(await screen.findByRole("button", { name }, { timeout: 4000 }));

describe("end to end: chat, pipeline and dashboard stay connected", () => {
  it("starts with NEX's overnight work, all computed from the demo pipeline", () => {
    render(<Everything />);
    const work = screen.getByRole("list", { name: /Trabajo realizado por NEX/ });
    expect(within(work).getByText("Analicé 6 prospectos.")).toBeInTheDocument();
    expect(within(work).getByText("Detecté 2 oportunidades calientes.")).toBeInTheDocument();
    expect(within(work).getByText(/Preparé 2 solicitudes de reunión que esperan tu aprobación/)).toBeInTheDocument();
    expect(screen.getAllByText(/Datos de demostración/).length).toBeGreaterThan(0);
    expect(screen.getByText("Métricas del negocio")).toBeInTheDocument();
  });

  it("a finished conversation appears in the dashboard and the pipeline, and its meeting request updates both", async () => {
    render(<Everything />);
    // The visitor asks for a person, leaves a name and an email.
    await click("Prefiero hablar con una persona");
    fireEvent.change(await screen.findByLabelText(/Escriba su nombre/, {}, { timeout: 4000 }), { target: { value: "Lucas" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await click("Por correo electrónico");
    fireEvent.change(await screen.findByLabelText(/Escriba su correo electrónico/, {}, { timeout: 4000 }), { target: { value: "lucas@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    // Dashboard: "just happened" lists it. Pipeline: the card is marked new, with its owner and next action.
    expect(await screen.findByText(/Recibí a Lucas por chat web/, {}, { timeout: 4000 })).toBeInTheDocument();
    const card = await screen.findByTestId("lead-chat-1");
    expect(within(card).getAllByText("Nuevo")).toHaveLength(2); // the "new" badge and the stage
    expect(within(card).getByText("Equipo de Nova")).toBeInTheDocument();
    expect(within(card).getAllByText("Responder personalmente a lo que pidió").length).toBeGreaterThan(0); // in the card and in the open summary
    // The new lead opens on its executive summary.
    expect(within(card).getByTestId("executive-summary")).toHaveTextContent("Lucas: pidió atención de una persona");

    // Approving a seeded meeting request lowers the pending count and moves the lead.
    const pending = screen.getByRole("heading", { name: /Necesita tu aprobación/ }).parentElement as HTMLElement;
    expect(within(pending).getAllByText(/Solicitud de reunión para/)).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId("lead-demo-1")).getByRole("button", { name: /Ver resumen ejecutivo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar y solicitar reunión" }));
    expect(within(pending).getAllByText(/Solicitud de reunión para/)).toHaveLength(1);
    expect(within(screen.getByTestId("lead-demo-1")).getByText("Reunión solicitada")).toBeInTheDocument();
    expect(screen.getByText(/Reunión solicitada \(demostración: no se envió nada/)).toBeInTheDocument();
  }, 40000);
});
