import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { DIMENSION_COPY } from "@/lib/audit-copy";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { GuidedChat } from "./GuidedChat";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const setup = () => render(<GuidedChat pack={NOVA_DRAFT_PACK} paceMs={0} />);
const choose = async (label: string) => fireEvent.click(await screen.findByRole("button", { name: label }, { timeout: 4000 }));
async function type(label: RegExp, value: string) {
  fireEvent.change(await screen.findByLabelText(label, {}, { timeout: 4000 }), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
}

describe("Guided chat", () => {
  it("opens by introducing NEX as an automated assistant and offering four ways in", async () => {
    setup();
    expect(await screen.findByText(/asistente automatizado de Nova Marketing Studio/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Quiero un diagnóstico de mi negocio" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prefiero hablar con una persona" })).toBeInTheDocument();
    expect(screen.getByText(/No se guarda ni se envía nada/)).toBeInTheDocument();
  });

  it("goes from first hello to a prepared handoff in one conversation", async () => {
    setup();
    await choose("Quiero un diagnóstico de mi negocio");
    await type(/Escriba su nombre/, "Ana");
    await type(/Nombre de su negocio/, "Café Sol");
    await choose("Conseguir más clientes");
    for (const dimension of AUDIT_DIMENSIONS) await choose(DIMENSION_COPY[dimension].options.none);

    // NEX shows it is working, then delivers the score with its meaning and the five-part summary.
    expect((await screen.findAllByTestId("working", {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    const result = await screen.findByTestId("result", {}, { timeout: 4000 });
    expect(result).toHaveTextContent("Estado actual:");
    expect(result).toHaveTextContent("Café Sol está empezando a construir su base digital");
    expect(result).toHaveTextContent("Lo primero que recomiendo");

    await choose("Un presupuesto amplio");
    await choose("Lo antes posible");
    await choose("Yo tomo la decisión");
    await choose("Por correo electrónico");
    await type(/Escriba su correo electrónico/, "ana@cafesol.com");

    const handoff = await screen.findByTestId("handoff", {}, { timeout: 4000 });
    expect(handoff).toHaveTextContent("Prospecto caliente");
    expect(handoff).toHaveTextContent("ana@cafesol.com");
    expect(handoff).toHaveTextContent("Business Score");
    expect(screen.getByText(/no se envió nada/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Empezar de nuevo" })).toBeInTheDocument();
  }, 30000);

  it("rejects an invalid email without moving on", async () => {
    setup();
    await choose("Prefiero hablar con una persona");
    await type(/Escriba su nombre/, "Pedro");
    await choose("Por correo electrónico");
    await type(/Escriba su correo electrónico/, "no es un correo");
    expect(await screen.findByRole("alert")).toHaveTextContent("no parece válido");
    expect(screen.queryByTestId("handoff")).not.toBeInTheDocument();
  });

  it("lets the visitor skip the contact and still prepares the handoff for a person", async () => {
    setup();
    await choose("Ya soy cliente");
    await type(/Escriba su nombre/, "Marta");
    await choose("Prefiero no dejar mi contacto");
    const handoff = await screen.findByTestId("handoff", {}, { timeout: 4000 });
    expect(handoff).toHaveTextContent("Lo atiende una persona");
    expect(handoff).toHaveTextContent("No dejó un medio de contacto");
  });

  it("restarts from the beginning", async () => {
    setup();
    await choose("Prefiero hablar con una persona");
    await type(/Escriba su nombre/, "Pedro");
    await choose("Prefiero no dejar mi contacto");
    fireEvent.click(await screen.findByRole("button", { name: "Empezar de nuevo" }, { timeout: 4000 }));
    expect(await screen.findByRole("button", { name: "Quiero un diagnóstico de mi negocio" }, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("handoff")).not.toBeInTheDocument());
  });
});
