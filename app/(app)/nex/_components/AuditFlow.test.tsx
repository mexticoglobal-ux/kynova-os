import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { DIMENSION_COPY } from "@/lib/audit-copy";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { AuditFlow } from "./AuditFlow";

function setup() {
  render(<AuditFlow pack={NOVA_DRAFT_PACK} analysisMs={0} />);
}

async function finish(level: "none" | "adHoc" | "defined" | "optimized") {
  fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
  for (const dimension of AUDIT_DIMENSIONS) {
    fireEvent.click(screen.getByRole("button", { name: DIMENSION_COPY[dimension].options[level] }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar|Ver mi diagnóstico/ }));
  }
  return screen.findByText("Business Score", {}, { timeout: 2000 });
}

describe("Business Audit flow", () => {
  it("opens by saying nothing is stored and that the result is self-reported", () => {
    setup();
    expect(screen.getByText(/no se guardan ni se envían a nadie/)).toBeInTheDocument();
    expect(screen.getByText(/Conozcamos su negocio/)).toBeInTheDocument();
  });

  it("reacts to each answer before moving on, and requires an answer to continue", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: DIMENSION_COPY.web.options.none }));
    expect(screen.getByTestId("reaction")).toHaveTextContent(DIMENSION_COPY.web.reaction.none);
    expect(screen.getByRole("button", { name: "Continuar" })).toBeEnabled();
  });

  it("goes back keeping the previous answer", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Comenzar" }));
    fireEvent.click(screen.getByRole("button", { name: DIMENSION_COPY.web.options.adHoc }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByRole("button", { name: DIMENSION_COPY.web.options.adHoc })).toHaveAttribute("aria-pressed", "true");
  });

  it("ends with the five-part consultant summary and the draft notice", async () => {
    setup();
    await finish("none");
    expect(screen.getByLabelText("Business Score 0 de 100")).toBeInTheDocument();
    for (const title of ["Lo que encontré", "Lo primero que recomiendo", "Lo que KYNOVA puede preparar por usted", "Lo que requiere su aprobación"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: /oportunidades más importantes/ })).toBeInTheDocument();
    expect(screen.getByText(/Servicios de ejemplo, en borrador/)).toBeInTheDocument();
    expect(screen.getByText(/No se guardó nada/)).toBeInTheDocument();
    expect(screen.getByText("Estado actual:")).toBeInTheDocument();
  });

  it("shows no opportunities section for a business with no gaps, and can restart", async () => {
    setup();
    await finish("optimized");
    expect(screen.getByLabelText("Business Score 100 de 100")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /oportunidad/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Repetir el diagnóstico" }));
    expect(screen.getByRole("button", { name: "Comenzar" })).toBeInTheDocument();
  });

  it("switches to tú and uses the business name", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Tú" }));
    expect(screen.getByText(/Conozcamos tu negocio/)).toBeInTheDocument();
  });
});
