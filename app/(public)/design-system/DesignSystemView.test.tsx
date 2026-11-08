import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { DesignSystemView } from "./DesignSystemView";

afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("design system page", () => {
  it("switches the theme on the document without storing anything", () => {
    render(
      <Providers>
        <DesignSystemView />
      </Providers>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "KYNOVA Design System V2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "NOVA Light" }));
    expect(document.documentElement.dataset.theme).toBe("nova-light");
    fireEvent.click(screen.getByRole("button", { name: "NOVA Dark" }));
    expect(document.documentElement.dataset.theme).toBe("nova-dark");
    expect(window.localStorage.length).toBe(0);
  });

  it("documents colors, buttons, cards, badges, charts, shadows and spacing", () => {
    render(
      <Providers>
        <DesignSystemView />
      </Providers>,
    );
    for (const title of ["Colores", "Pestañas, cifras y tablas", "Marcas", "Botones", "Tarjetas, badges e iconos", "Campos y opciones", "Gráficos", "Sombras y espaciados"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
  });
});
