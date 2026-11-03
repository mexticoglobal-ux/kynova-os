import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { es } from "@/lib/i18n/messages/es";
import MarketingPage from "./page";

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("Marketing page", () => {
  it("shows the creator studio right under the page header and keeps the demo campaigns below", async () => {
    render(
      <Providers>
        <MarketingPage />
      </Providers>,
    );

    const pageTitle = screen.getByRole("heading", { level: 1, name: es.modules.marketing.title });
    const studioTitle = await screen.findByRole("heading", { level: 2, name: es.creatorStudio.title });
    const campaigns = screen.getByRole("heading", { level: 2, name: es.modules.marketing.tableTitle });

    expect(pageTitle.compareDocumentPosition(studioTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(studioTitle.compareDocumentPosition(campaigns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText(es.common.demoData).length).toBeGreaterThan(0);
  });
});
