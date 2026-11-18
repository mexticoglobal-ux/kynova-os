import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ mode: "demo" as "demo" | "backend" }));
vi.mock("@/components/session/SessionProvider", () => ({ useSession: () => ({ mode: session.mode }) }));

import { I18nProvider } from "@/components/i18n/I18nProvider";
import { ModuleView } from "./ModuleView";

const show = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

afterEach(() => {
  cleanup();
  session.mode = "demo";
});

describe("ModuleView with real data", () => {
  it("shows the example KPIs, insights and opportunities in the demonstration", () => {
    show(<ModuleView moduleKey="sales" hideExamplesWhenConnected />);
    expect(screen.getByText("Valor del pipeline")).toBeTruthy();
    expect(screen.getByText("Oportunidades recientes")).toBeTruthy();
    expect(screen.queryByText(/Sin información/)).toBeNull();
  });

  it("signed in, hides the examples and says Sin información where there is no source", () => {
    session.mode = "backend";
    show(<ModuleView moduleKey="sales" hideExamplesWhenConnected>real content</ModuleView>);
    expect(screen.getByText("real content")).toBeTruthy();
    expect(screen.queryByText("Valor del pipeline")).toBeNull();
    expect(screen.queryByText("Oportunidades recientes")).toBeNull();
    expect(screen.queryByText("Datos de demostración")).toBeNull();
    expect(screen.getByText(/Sin información/)).toBeTruthy();
  });

  it("other modules keep their examples even when signed in (only the opted-in screen changes)", () => {
    session.mode = "backend";
    show(<ModuleView moduleKey="finance" />);
    expect(screen.queryByText(/Sin información/)).toBeNull();
  });
});
