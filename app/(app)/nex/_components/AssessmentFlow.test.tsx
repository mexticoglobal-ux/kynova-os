import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { es } from "@/lib/i18n/messages/es";
import { NexChat } from "./NexChat";

const copy = es.nex.assessment;

// One answer per question, in order: sector, team, channel, CRM, problem, goal.
const ANSWERS = [
  copy.options.sector.realEstate,
  copy.options.teamSize.solo,
  copy.options.channel.referrals,
  copy.options.crm.spreadsheets,
  copy.options.problem.manualWork,
  copy.options.goal.automate,
];

const progress = (current: number) => copy.progress.replace("{current}", String(current)).replace("{total}", "6");

function startAssessment() {
  render(
    <Providers>
      <NexChat />
    </Providers>,
  );
  fireEvent.click(screen.getByRole("button", { name: copy.start }));
}

function answer(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Business Assessment v0", () => {
  it("starts from the NEX quick action and always shows the not-saved notice", () => {
    startAssessment();
    expect(screen.getByText(copy.notice)).toBeInTheDocument();
    expect(screen.getByText(progress(1))).toBeInTheDocument();
    expect(screen.getByText(copy.questions.sector)).toBeInTheDocument();
  });

  it("advances, goes back to the previous question keeping its answer, and restarts", () => {
    startAssessment();
    expect(screen.getByRole("button", { name: copy.back })).toBeDisabled();

    answer(ANSWERS[0] ?? "");
    expect(screen.getByText(progress(2))).toBeInTheDocument();
    expect(screen.getByText(copy.questions.teamSize)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.back }));
    expect(screen.getByText(progress(1))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ANSWERS[0] })).toHaveAttribute("aria-pressed", "true");

    answer(ANSWERS[0] ?? "");
    answer(ANSWERS[1] ?? "");
    expect(screen.getByText(progress(3))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.restart }));
    expect(screen.getByText(progress(1))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ANSWERS[0] })).toHaveAttribute("aria-pressed", "false");
  });

  it("summarizes only the given answers and links 2–3 recommended modules, then lets the user go back", () => {
    startAssessment();
    ANSWERS.forEach(answer);

    const summary = screen.getByRole("heading", { name: copy.resultTitle }).parentElement as HTMLElement;
    for (const label of ANSWERS) expect(within(summary).getByText(label)).toBeInTheDocument();

    const recommended = screen.getByRole("heading", { name: copy.recommendedTitle }).parentElement as HTMLElement;
    const links = within(recommended).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/automation", "/clients", "/properties"]);
    expect(links[0]).toHaveTextContent(es.nav.automation);

    // Each reason names the answers that really contributed, and only those.
    expect(links[0]).toHaveTextContent(`${copy.labels.problem}: ${copy.options.problem.manualWork}`);
    expect(links[0]).not.toHaveTextContent(copy.labels.sector);
    expect(links[2]).toHaveTextContent(`${copy.labels.sector}: ${copy.options.sector.realEstate}`);
    expect(links[2]).not.toHaveTextContent(copy.labels.problem);

    expect(within(recommended).getByText(copy.demoNote)).toBeInTheDocument();
    expect(screen.getByText(copy.notice)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: copy.back }));
    expect(screen.getByText(progress(6))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ANSWERS[5] })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts every new view at the top of the NEX scroll area without losing answers", () => {
    startAssessment();
    const scroller = document.querySelector<HTMLElement>("[data-nex-scroll]");
    if (!scroller) throw new Error("NEX scroll area not found");
    const scrollDownThen = (action: () => void) => {
      scroller.scrollTop = 240;
      expect(scroller.scrollTop).toBe(240);
      action();
      expect(scroller.scrollTop).toBe(0);
    };

    scrollDownThen(() => answer(ANSWERS[0] ?? ""));
    expect(screen.getByText(progress(2))).toBeInTheDocument();

    scrollDownThen(() => fireEvent.click(screen.getByRole("button", { name: copy.back })));
    expect(screen.getByRole("button", { name: ANSWERS[0] })).toHaveAttribute("aria-pressed", "true");

    ANSWERS.slice(0, 5).forEach(answer);
    scrollDownThen(() => answer(ANSWERS[5] ?? ""));
    expect(screen.getByRole("heading", { name: copy.resultTitle })).toBeInTheDocument();

    scrollDownThen(() => fireEvent.click(screen.getByRole("button", { name: copy.back })));
    expect(screen.getByRole("button", { name: ANSWERS[5] })).toHaveAttribute("aria-pressed", "true");
  });

  it("never writes the answers to localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    startAssessment();
    ANSWERS.forEach(answer);
    fireEvent.click(screen.getByRole("button", { name: copy.restart }));

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it("returns to the chat when leaving the assessment", () => {
    startAssessment();
    fireEvent.click(screen.getByRole("button", { name: copy.exit }));
    expect(screen.getByRole("button", { name: copy.start })).toBeInTheDocument();
    expect(screen.queryByText(copy.notice)).not.toBeInTheDocument();
  });
});
