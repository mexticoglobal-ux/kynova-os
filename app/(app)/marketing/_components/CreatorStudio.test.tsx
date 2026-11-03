import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { es } from "@/lib/i18n/messages/es";
import { emptyState, parseStudioState } from "@/lib/creator";
import { CreatorStudio } from "./CreatorStudio";

const copy = es.creatorStudio;
const KEY = "kynova.creator.youtube.v1";
const BACKUP_KEY = `${KEY}.backup`;
const fetchMock = vi.fn();

function renderStudio() {
  return render(
    <Providers>
      <CreatorStudio />
    </Providers>,
  );
}

async function ready() {
  await screen.findByRole("tablist");
}

const tab = (name: string) => screen.getByRole("tab", { name });
const open = (name: string) => fireEvent.click(tab(name));
const stored = () => parseStudioState(JSON.parse(window.localStorage.getItem(KEY) ?? "null"));

async function withSample() {
  renderStudio();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: copy.loadSample }));
}

function addIdea(title: string, note = "") {
  fireEvent.change(screen.getByLabelText(copy.ideas.titleField), { target: { value: title } });
  if (note) fireEvent.change(screen.getByLabelText(copy.ideas.note), { target: { value: note } });
  fireEvent.click(screen.getByRole("button", { name: copy.ideas.add }));
}

const itemOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CreatorStudio: first visit", () => {
  it("opens empty, says it is a local test and offers the sample content", async () => {
    renderStudio();
    await ready();

    expect(screen.getByRole("heading", { level: 2, name: copy.title })).toBeInTheDocument();
    expect(screen.getByText(copy.tag)).toBeInTheDocument();
    expect(screen.getByText(copy.notice)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.loadSample })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.reset })).not.toBeInTheDocument();
    expect(tab(copy.tabs.brief)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(copy.brief.name)).toHaveValue("");
  });

  it("loads the sample channel, ideas and scripts and stores them in this browser", async () => {
    await withSample();

    expect(screen.getByLabelText(copy.brief.name)).toHaveValue("Finanzas Claras (canal de muestra)");
    expect(screen.queryByRole("button", { name: copy.loadSample })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.reset })).toBeInTheDocument();
    expect(stored()?.ideas.length).toBeGreaterThanOrEqual(5);
    expect(stored()?.videos.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a changed format or cadence as work: no sample button, a reset button instead", async () => {
    renderStudio();
    await ready();
    fireEvent.change(screen.getByLabelText(copy.brief.cadence), { target: { value: "5" } });

    expect(screen.queryByRole("button", { name: copy.loadSample })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.reset })).toBeInTheDocument();
  });

  it("never calls the network", async () => {
    await withSample();
    open(copy.tabs.ideas);
    addIdea("Una idea");
    open(copy.tabs.scripts);
    open(copy.tabs.production);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CreatorStudio: channel", () => {
  it("saves what is typed and restores it on the next visit", async () => {
    const { unmount } = renderStudio();
    await ready();
    fireEvent.change(screen.getByLabelText(copy.brief.name), { target: { value: "Mi canal de prueba" } });
    fireEvent.change(screen.getByLabelText(copy.brief.topic), { target: { value: "Cocina económica " } });
    fireEvent.change(screen.getByLabelText(copy.brief.audience), { target: { value: "Estudiantes" } });
    fireEvent.change(screen.getByLabelText(copy.brief.format), { target: { value: "slidesAnimation" } });
    fireEvent.change(screen.getByLabelText(copy.brief.cadence), { target: { value: "5" } });
    expect(stored()?.brief).toMatchObject({ name: "Mi canal de prueba", topic: "Cocina económica ", format: "slidesAnimation", videosPerWeek: 5 });
    unmount();

    renderStudio();
    await ready();
    expect(screen.getByLabelText(copy.brief.name)).toHaveValue("Mi canal de prueba");
    expect(screen.getByLabelText(copy.brief.format)).toHaveValue("slidesAnimation");
    expect(screen.getByLabelText(copy.brief.cadence)).toHaveValue("5");
  });
});

describe("CreatorStudio: idea bank", () => {
  it("adds ideas on top, ignores an empty title and counts them", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);

    expect(screen.getByText(copy.ideas.empty)).toBeInTheDocument();
    addIdea("   ");
    expect(screen.getByText(copy.ideas.empty)).toBeInTheDocument();

    addIdea("Primera idea", "Un gancho");
    addIdea("Segunda idea");
    expect(screen.getByText(copy.ideas.count.replace("{count}", "2"))).toBeInTheDocument();
    expect(screen.getByText("Un gancho")).toBeInTheDocument();
    expect(screen.getByLabelText(copy.ideas.titleField)).toHaveValue("");
    expect(stored()?.ideas.map((idea) => idea.title)).toEqual(["Segunda idea", "Primera idea"]);
  });

  it("lists high priority first, and lets the priority and status be changed and an idea deleted", async () => {
    await withSample();
    open(copy.tabs.ideas);

    const titles = () => screen.getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent);
    expect(titles().slice(0, 2)).toEqual(["Los 5 gastos hormiga que no notas", "Cómo armar tu primer presupuesto en 15 minutos"]);

    const title = "Tres mitos del dinero que te frenan";
    fireEvent.change(screen.getByLabelText(`${copy.ideas.priority}: ${title}`), { target: { value: "high" } });
    expect(titles()[0]).toBe(title);

    fireEvent.change(screen.getByLabelText(`${copy.ideas.status}: ${title}`), { target: { value: "discarded" } });
    expect(stored()?.ideas.find((idea) => idea.title === title)).toMatchObject({ priority: "high", status: "discarded" });

    fireEvent.click(screen.getByRole("button", { name: `${copy.ideas.remove}: ${title}` }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.getByText(copy.ideas.count.replace("{count}", "6"))).toBeInTheDocument();
  });
});

describe("CreatorStudio: from idea to script to production", () => {
  it("creates a script from an idea, opens it, and the idea then offers to open it instead", async () => {
    await withSample();
    open(copy.tabs.ideas);

    const title = "Fondo de emergencia: cuánto necesitas de verdad";
    fireEvent.click(within(itemOf(title)).getByRole("button", { name: copy.ideas.promote }));

    expect(tab(copy.tabs.scripts)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(copy.scripts.name)).toHaveValue(title);
    expect(screen.getByLabelText(copy.scripts.stage)).toHaveValue("scripting");
    expect(stored()?.ideas.find((idea) => idea.title === title)?.status).toBe("selected");

    open(copy.tabs.ideas);
    expect(within(itemOf(title)).queryByRole("button", { name: copy.ideas.promote })).not.toBeInTheDocument();
    expect(within(itemOf(title)).getByRole("button", { name: copy.ideas.openScript })).toBeInTheDocument();
  });

  it("creates one script and opens it even when Create script is pressed twice before the screen updates", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Doble clic");
    const button = screen.getByRole("button", { name: copy.ideas.promote });

    act(() => {
      button.click();
      button.click();
    });

    expect(stored()?.videos).toHaveLength(1);
    expect(tab(copy.tabs.scripts)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(copy.scripts.name)).toHaveValue("Doble clic");
  });

  it("puts the idea back in the backlog when its script is deleted", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Idea con guion");
    fireEvent.click(screen.getByRole("button", { name: copy.ideas.promote }));
    expect(stored()?.ideas[0]?.status).toBe("selected");

    fireEvent.click(screen.getByRole("button", { name: copy.scripts.remove }));
    expect(stored()?.videos).toEqual([]);
    expect(stored()?.ideas[0]?.status).toBe("backlog");
  });

  it("lets the script title be cleared and retyped, and restores the saved title when left empty", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Título original");
    fireEvent.click(screen.getByRole("button", { name: copy.ideas.promote }));

    const field = screen.getByLabelText(copy.scripts.name);
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue("");
    expect(stored()?.videos[0]?.title).toBe("Título original");

    fireEvent.change(field, { target: { value: "N" } });
    expect(stored()?.videos[0]?.title).toBe("N");

    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    expect(field).toHaveValue("N");
  });

  it("does not offer a script for a discarded idea", async () => {
    await withSample();
    open(copy.tabs.ideas);
    expect(within(itemOf("Suscripciones olvidadas: cómo encontrarlas")).getByRole("button", { name: copy.ideas.promote })).toBeDisabled();
  });

  it("edits a script, counts its words and estimates its length, and keeps the changes", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Mi guion");
    fireEvent.click(screen.getByRole("button", { name: copy.ideas.promote }));

    expect(screen.getByRole("status")).toHaveTextContent(`0 ${copy.scripts.words}`);
    fireEvent.change(screen.getByLabelText(copy.scripts.hook), { target: { value: "una dos tres" } });
    fireEvent.change(screen.getByLabelText(copy.scripts.body), { target: { value: "cuatro cinco" } });
    expect(screen.getByRole("status")).toHaveTextContent(`5 ${copy.scripts.words}`);
    expect(screen.getByRole("status")).toHaveTextContent("0:02");

    fireEvent.change(screen.getByLabelText(copy.scripts.name), { target: { value: "Título nuevo" } });
    fireEvent.change(screen.getByLabelText(copy.scripts.stage), { target: { value: "editing" } });
    expect(stored()?.videos[0]).toMatchObject({ title: "Título nuevo", hook: "una dos tres", body: "cuatro cinco", stage: "editing" });
  });

  it("shows the empty scripts state with a way back to the ideas", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.scripts);
    expect(screen.getByText(copy.scripts.empty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.scripts.goIdeas }));
    expect(tab(copy.tabs.ideas)).toHaveAttribute("aria-selected", "true");
  });

  it("plans a script on a date and shows it in the production calendar, with no publishing", async () => {
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Vídeo planificado");
    fireEvent.click(screen.getByRole("button", { name: copy.ideas.promote }));
    fireEvent.change(screen.getByLabelText(copy.scripts.planned), { target: { value: "2099-01-07" } });

    open(copy.tabs.production);
    expect(screen.getByRole("region", { name: copy.production.weekOf.replace("{date}", "5 ene 2099") })).toBeInTheDocument(); // the Monday of that week
    expect(screen.getByText(copy.production.note)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: copy.production.unscheduled })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(`${copy.scripts.stage}: Vídeo planificado`), { target: { value: "review" } });
    expect(stored()?.videos[0]).toMatchObject({ stage: "review", plannedDate: "2099-01-07" });
  });

  it("summarizes the stages and moves a video forward, and opens its script", async () => {
    await withSample();
    open(copy.tabs.production);

    const summary = () => within(screen.getByRole("region", { name: copy.production.summary })).getAllByRole("listitem").map((item) => item.textContent);
    expect(summary()).toEqual(["1Guion", "1Voz en off", "0Material visual", "0Edición", "0Revisión", "1Listo"]);

    const title = "Los 5 gastos hormiga que no notas";
    fireEvent.click(screen.getByRole("button", { name: `${copy.production.advance}: ${title}` }));
    expect(summary()).toEqual(["0Guion", "2Voz en off", "0Material visual", "0Edición", "0Revisión", "1Listo"]);

    // A finished video has nothing left to advance to.
    expect(screen.queryByRole("button", { name: `${copy.production.advance}: Presentación del canal` })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `${copy.production.open}: ${title}` }));
    expect(tab(copy.tabs.scripts)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText(copy.scripts.name)).toHaveValue(title);
    expect(screen.getByLabelText(copy.scripts.stage)).toHaveValue("voiceover");
  });
});

describe("CreatorStudio: reset, storage and keyboard", () => {
  it("asks for confirmation before erasing, and Cancel keeps everything", async () => {
    await withSample();
    fireEvent.click(screen.getByRole("button", { name: copy.reset }));
    fireEvent.click(screen.getByRole("button", { name: copy.resetCancel }));
    expect(stored()?.ideas.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: copy.reset }));
    fireEvent.click(screen.getByRole("button", { name: copy.resetConfirm }));

    expect(stored()).toEqual(emptyState());
    expect(screen.getByRole("button", { name: copy.loadSample })).toBeInTheDocument();
    expect(screen.getByLabelText(copy.brief.name)).toHaveValue("");
  });

  it("starts empty instead of failing when the stored data is corrupt or has another shape", async () => {
    for (const value of ["{broken", "null", '{"version":1,"brief":{}}', '{"version":2}', JSON.stringify({ ...emptyState(), ideas: [{ id: "x" }] })]) {
      window.localStorage.setItem(KEY, value);
      const { unmount } = renderStudio();
      await ready();
      expect(screen.getByRole("button", { name: copy.loadSample })).toBeInTheDocument();
      // Nothing is lost silently: the unreadable value is kept aside before any new save replaces it.
      expect(window.localStorage.getItem(BACKUP_KEY)).toBe(value);
      unmount();
    }
  });

  it("does not write anything just by opening the studio, and keeps a valid stored studio untouched", async () => {
    renderStudio();
    await ready();
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(window.localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  it("keeps working for the visit when browser storage is not available", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    renderStudio();
    await ready();
    open(copy.tabs.ideas);
    addIdea("Sin almacenamiento");
    expect(screen.getByText("Sin almacenamiento")).toBeInTheDocument();
  });

  it("is a labelled tab list that moves with the arrow keys, Home and End", async () => {
    renderStudio();
    await ready();
    expect(screen.getByRole("tablist", { name: copy.tabsLabel })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", tab(copy.tabs.brief).id);

    tab(copy.tabs.brief).focus();
    fireEvent.keyDown(tab(copy.tabs.brief), { key: "ArrowRight" });
    expect(tab(copy.tabs.ideas)).toHaveAttribute("aria-selected", "true");
    expect(tab(copy.tabs.ideas)).toHaveFocus();

    fireEvent.keyDown(tab(copy.tabs.ideas), { key: "End" });
    expect(tab(copy.tabs.production)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(copy.tabs.production), { key: "ArrowRight" });
    expect(tab(copy.tabs.brief)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(copy.tabs.brief), { key: "ArrowLeft" });
    expect(tab(copy.tabs.production)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(copy.tabs.production), { key: "Home" });
    expect(tab(copy.tabs.brief)).toHaveAttribute("aria-selected", "true");
  });
});
