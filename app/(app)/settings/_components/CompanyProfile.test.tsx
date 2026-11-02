import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { ASSESSMENT_OPTIONS, ASSESSMENT_QUESTIONS } from "@/lib/contracts/assessment";
import { es } from "@/lib/i18n/messages/es";
import { CompanyProfile } from "./CompanyProfile";

const copy = es.companyProfile;
const labels = es.nex.assessment.labels;
const options = es.nex.assessment.options;

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1";
const owner = { id: TENANT_ID, name: "Empresa de prueba A", role: "owner" };

// The API returns more than the form edits: the component must keep only the editable fields.
const profile = {
  tenantId: TENANT_ID,
  tradeName: "Empresa de prueba A",
  country: "CR",
  locale: "es",
  sector: "software",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
  questionnaireVersion: 1,
  createdAt: "2026-11-02T10:00:00+00:00",
  updatedAt: "2026-11-02T10:00:00+00:00",
};

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });

function renderProfile() {
  return render(
    <Providers>
      <CompanyProfile />
    </Providers>,
  );
}

const field = (label: string) => screen.getByLabelText(label);
const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

async function fillEmptyProfile() {
  await screen.findByLabelText(copy.fields.tradeName);
  fireEvent.change(field(copy.fields.country), { target: { value: "cr" } });
  const answers = { sector: "retail", teamSize: "solo", channel: "social", crm: "none", problem: "cash", goal: "controlFinances" };
  for (const question of ASSESSMENT_QUESTIONS) fireEvent.change(field(labels[question]), { target: { value: answers[question] } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("CompanyProfile: loading", () => {
  it("shows the loading state, then the company, the role and the saved profile", async () => {
    fetchMock.mockReturnValue(reply(200, { tenant: owner, profile }));
    renderProfile();

    expect(screen.getByText(es.common.loading)).toBeInTheDocument();
    await screen.findByLabelText(copy.fields.tradeName);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/profile", { cache: "no-store" });
    expect(screen.getByText(copy.pilotNotice)).toBeInTheDocument();
    expect(screen.getByText(copy.realDataTag)).toBeInTheDocument();
    expect(screen.getByText(copy.roles.owner)).toBeInTheDocument();
    expect(field(copy.fields.tradeName)).toHaveValue("Empresa de prueba A");
    expect(field(copy.fields.country)).toHaveValue("CR");
    expect(field(copy.fields.language)).toHaveValue("es");
    expect(field(labels.sector)).toHaveValue("software");
    expect(field(labels.goal)).toHaveValue("moreSales");
    expect(screen.queryByText(copy.noProfileYet)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
  });

  it("starts a company without a profile from its name, with every answer still to choose", async () => {
    fetchMock.mockReturnValue(reply(200, { tenant: owner, profile: null }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    expect(screen.getByText(copy.noProfileYet)).toBeInTheDocument();
    expect(field(copy.fields.tradeName)).toHaveValue("Empresa de prueba A");
    expect(field(copy.fields.country)).toHaveValue("");
    for (const question of ASSESSMENT_QUESTIONS) expect(field(labels[question])).toHaveValue("");
  });

  it("makes the profile read-only for a member who is not an owner", async () => {
    fetchMock.mockReturnValue(reply(200, { tenant: { ...owner, role: "member" }, profile }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    expect(screen.getByText(copy.roles.member)).toBeInTheDocument();
    expect(screen.getByText(copy.readOnly)).toBeInTheDocument();
    expect(field(copy.fields.tradeName)).toBeDisabled();
    expect(field(labels.sector)).toBeDisabled();
    expect(screen.queryByRole("button", { name: copy.save })).not.toBeInTheDocument();
  });

  it.each([
    ["no session", 401, { error: "unauthorized" }, copy.errors.unauthorized],
    ["no company", 404, { error: "no_tenant" }, copy.errors.noTenant],
    ["project not configured", 503, { error: "not_configured" }, copy.errors.notConfigured],
    ["unavailable", 503, { error: "unavailable" }, copy.errors.unavailable],
    ["a 401 without a code", 401, null, copy.errors.unauthorized],
    ["an unreadable error", 500, null, copy.errors.unavailable],
    ["a payload that does not match the contract", 200, { tenant: { id: "x" }, profile: null }, copy.errors.unavailable],
    ["a profile with an out-of-domain value", 200, { tenant: owner, profile: { ...profile, sector: "other-sector" } }, copy.errors.unavailable],
  ])("reports %s with an alert and no form", async (_name, status, body, message) => {
    fetchMock.mockReturnValue(reply(status, body));
    renderProfile();

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText(copy.fields.tradeName)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.save })).not.toBeInTheDocument();
  });

  it("offers the sign-in link only when there is no session", async () => {
    fetchMock.mockReturnValue(reply(401, { error: "unauthorized" }));
    renderProfile();
    expect(await screen.findByRole("link", { name: copy.signIn })).toHaveAttribute("href", "/spike/login");

    fetchMock.mockReset();
    fetchMock.mockReturnValue(reply(404, { error: "no_tenant" }));
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));
    await screen.findByText(copy.errors.noTenant);
    expect(screen.queryByRole("link", { name: copy.signIn })).not.toBeInTheDocument();
  });

  it("recovers with Retry after a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.errors.network);

    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile }));
    fireEvent.click(screen.getByRole("button", { name: copy.retry }));

    await screen.findByLabelText(copy.fields.tradeName);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("CompanyProfile: editing and saving", () => {
  it("creates the profile with exactly the editable fields, never the tenant or the author", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: null }));
    renderProfile();
    await fillEmptyProfile();

    // The country is typed in lower case and normalized; the language falls back to the interface language.
    expect(field(copy.fields.country)).toHaveValue("CR");
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: { ...profile, sector: "retail", teamSize: "solo", channel: "social", crm: "none", problem: "cash", goal: "controlFinances" } }));
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByText(copy.saved)).toBeInTheDocument();
    const [url, init] = lastCall();
    expect(url).toBe("/api/profile");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      tradeName: "Empresa de prueba A",
      country: "CR",
      locale: "es",
      sector: "retail",
      teamSize: "solo",
      channel: "social",
      crm: "none",
      problem: "cash",
      goal: "controlFinances",
    });
    expect(screen.queryByText(copy.noProfileYet)).not.toBeInTheDocument();
    expect(field(labels.sector)).toHaveValue("retail");
  });

  it("updates an existing profile and shows the confirmation", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    fireEvent.change(field(copy.fields.tradeName), { target: { value: "  Empresa A renombrada  " } });
    fireEvent.change(field(copy.fields.language), { target: { value: "en" } });
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: { ...profile, tradeName: "Empresa A renombrada", locale: "en" } }));
    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    await screen.findByText(copy.saved);
    expect(JSON.parse(String(lastCall()[1].body))).toMatchObject({ tradeName: "Empresa A renombrada", locale: "en" });
    expect(field(copy.fields.tradeName)).toHaveValue("Empresa A renombrada");
  });

  it("does not call the API when something is missing, and says so", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: null }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    fireEvent.click(screen.getByRole("button", { name: copy.save }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.incomplete);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty name or a country that is not two letters before sending", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    fireEvent.change(field(copy.fields.tradeName), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.incomplete);

    fireEvent.change(field(copy.fields.tradeName), { target: { value: "Empresa A" } });
    fireEvent.change(field(copy.fields.country), { target: { value: "C" } });
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.incomplete);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the form and the entered values and shows the reason when saving fails", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);
    fireEvent.change(field(copy.fields.tradeName), { target: { value: "Nombre editado" } });

    const failures: Array<[number, unknown, string]> = [
      [403, { error: "forbidden" }, copy.errors.forbidden],
      [409, { error: "conflict" }, copy.errors.conflict],
      [400, { error: "invalid_profile" }, copy.errors.invalid],
      [401, { error: "unauthorized" }, copy.errors.unauthorized],
      [503, { error: "unavailable" }, copy.errors.unavailable],
    ];
    for (const [status, body, message] of failures) {
      fetchMock.mockReturnValueOnce(reply(status, body));
      fireEvent.click(screen.getByRole("button", { name: copy.save }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(field(copy.fields.tradeName)).toHaveValue("Nombre editado");
      expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
      expect(screen.queryByText(copy.saved)).not.toBeInTheDocument();
    }

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: copy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.errors.network);
  });

  it("disables the form and shows the saving state while the request is in flight, and ignores a second submit", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const form = screen.getByRole("button", { name: copy.save }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(await screen.findByRole("button", { name: copy.saving })).toBeDisabled();
    expect(field(copy.fields.tradeName)).toBeDisabled();
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    finish({ ok: true, status: 200, json: async () => ({ tenant: owner, profile }) });
    await screen.findByText(copy.saved);
    expect(screen.getByRole("button", { name: copy.save })).toBeEnabled();
  });

  it("names the country from its code in the current language", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: null }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    expect(screen.getByText(copy.fields.countryHint)).toBeInTheDocument();
    fireEvent.change(field(copy.fields.country), { target: { value: "cr" } });
    await waitFor(() => expect(screen.getByText("Costa Rica")).toBeInTheDocument());
  });
});

describe("CompanyProfile: language data", () => {
  it("has a label in every dictionary option for every closed answer, so no select shows a raw key", () => {
    for (const question of ASSESSMENT_QUESTIONS) {
      for (const option of ASSESSMENT_OPTIONS[question]) {
        expect((options[question] as Record<string, string>)[option]).toEqual(expect.any(String));
        expect((options[question] as Record<string, string>)[option]).not.toBe("");
      }
    }
  });

  it("renders every option of every answer as a choice", async () => {
    fetchMock.mockReturnValueOnce(reply(200, { tenant: owner, profile: null }));
    renderProfile();
    await screen.findByLabelText(copy.fields.tradeName);

    for (const question of ASSESSMENT_QUESTIONS) {
      const select = field(labels[question]);
      const choices = within(select).getAllByRole("option");
      expect(choices).toHaveLength(ASSESSMENT_OPTIONS[question].length + 1); // + "select an option"
    }
  });
});
