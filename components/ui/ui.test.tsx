import { fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { Button, buttonClass } from "./Button";
import { Card } from "./Card";
import { IconBadge } from "./IconBadge";
import { PageHeader } from "./PageHeader";
import { choiceClass } from "./choice";

describe("design system primitives", () => {
  it("builds every button from the same classes and keeps the caller's layout classes", () => {
    expect(buttonClass()).toBe("btn btn-secondary btn-md");
    expect(buttonClass("primary", "lg", "mt-4")).toBe("btn btn-primary btn-lg mt-4");
    render(<Button variant="accent">Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("btn-accent");
  });

  it("disables a button without changing its look classes", () => {
    render(<Button disabled>Nada</Button>);
    expect(screen.getByRole("button", { name: "Nada" })).toBeDisabled();
  });

  it("renders cards, badges and icon badges with the shared classes", () => {
    render(
      <Card as="section" aria-label="tarjeta">
        <Badge tone="success">Activo</Badge>
        <IconBadge icon={Bot} tone="accent" />
      </Card>,
    );
    expect(screen.getByLabelText("tarjeta").className).toContain("card");
    expect(screen.getByText("Activo").className).toContain("text-success");
  });

  it("marks a selected choice with the accent and leaves the rest neutral", () => {
    expect(choiceClass(true)).toContain("border-accent");
    expect(choiceClass(false)).toContain("border-line");
  });

  it("shows a page header with eyebrow, title, subtitle and actions", () => {
    render(
      <PageHeader icon={Bot} eyebrow="Ventas" title="Pipeline" subtitle="Todo en un lugar" actions={<Button>Acción</Button>}>
        <p>Estado</p>
      </PageHeader>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toBeInTheDocument();
    expect(screen.getByText("Ventas")).toBeInTheDocument();
    expect(screen.getByText("Todo en un lugar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acción" }));
    expect(screen.getByText("Estado")).toBeInTheDocument();
  });
});
