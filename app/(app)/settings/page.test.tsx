import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { es } from "@/lib/i18n/messages/es";
import SettingsPage from "./page";

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1";

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tenant: { id: TENANT_ID, name: "Empresa de prueba A", role: "owner" }, profile: null }) }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Settings page", () => {
  it("shows the company profile right under the page header and keeps the demo module content", async () => {
    render(
      <Providers>
        <SettingsPage />
      </Providers>,
    );

    const pageTitle = screen.getByRole("heading", { level: 1, name: es.modules.settings.title });
    const profileTitle = await screen.findByRole("heading", { level: 2, name: es.companyProfile.title });
    const demoTable = screen.getByRole("heading", { level: 2, name: es.modules.settings.tableTitle });

    // Document order: header, then the real profile, then the demo content.
    expect(pageTitle.compareDocumentPosition(profileTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(profileTitle.compareDocumentPosition(demoTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(es.common.demoData).length).toBeGreaterThan(0);
  });
});
