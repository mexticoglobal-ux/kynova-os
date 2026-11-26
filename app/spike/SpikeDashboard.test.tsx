import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/components/i18n/I18nProvider";
import type { SpikeItemsResult } from "@/lib/db/spike-items";
import { es } from "@/lib/i18n/messages/es";
import { SpikeDashboard } from "./SpikeDashboard";

const show = (result: SpikeItemsResult) => render(<I18nProvider><SpikeDashboard email="persona@example.test" result={result} canaryConfigured={false} /></I18nProvider>);

describe("spike screen", () => {
  it("says the test table is missing without showing a failure or claiming an isolation result", () => {
    show({ status: "not_provisioned" });
    expect(screen.getByRole("status")).toHaveTextContent(es.spike.notProvisioned);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(es.spike.noRows)).not.toBeInTheDocument();
  });

  it("still shows the error for a real failure", () => {
    show({ status: "unavailable" });
    expect(screen.getByRole("alert")).toHaveTextContent(es.spike.error);
  });

  it("keeps 'no visible rows' for an existing table that returns nothing", () => {
    show({ status: "ok", items: [] });
    expect(screen.getByText(es.spike.noRows)).toBeInTheDocument();
  });
});
