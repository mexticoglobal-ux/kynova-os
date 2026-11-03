import { describe, expect, it } from "vitest";
import { CREATOR_LIMITS, PRODUCTION_STAGES, type CreatorStudioState } from "@/lib/contracts/creator";
import {
  addDays,
  addIdea,
  emptyState,
  formatDuration,
  isIsoDate,
  localToday,
  nextStage,
  parseStudioState,
  planProduction,
  promoteIdea,
  removeIdea,
  removeVideo,
  sampleState,
  scriptStats,
  setStage,
  sortIdeas,
  stageCounts,
  updateBrief,
  updateIdea,
  updateVideo,
  videoOfIdea,
  weekStart,
} from "./creator";

const NOW = "2026-11-02T10:00:00.000Z";
const TODAY = "2026-11-02"; // a Monday

const withIdea = (): CreatorStudioState => addIdea(emptyState(), { title: "  Idea uno  ", note: " nota ", priority: "high" }, "i1", NOW);

describe("dates", () => {
  it("validates real calendar dates only", () => {
    for (const ok of ["2026-11-02", "2028-02-29"]) expect(isIsoDate(ok)).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "20261102", "", 5, null, "2026-11-02T10:00"]) expect(isIsoDate(bad)).toBe(false);
  });

  it("adds days across month and year boundaries and finds the Monday of a week", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekStart("2026-11-02")).toBe("2026-11-02"); // Monday
    expect(weekStart("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });

  it("reads today from the local calendar", () => {
    expect(localToday(new Date(2026, 10, 2, 23, 59))).toBe("2026-11-02");
    expect(localToday(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("channel brief", () => {
  it("updates fields, clamps lengths and ignores invalid values", () => {
    const state = updateBrief(emptyState(), { name: "x".repeat(500), topic: "Finanzas", format: "screenRecording", videosPerWeek: 4 });
    expect(state.brief.name).toHaveLength(CREATOR_LIMITS.name);
    expect(state.brief).toMatchObject({ topic: "Finanzas", format: "screenRecording", videosPerWeek: 4 });

    const unchanged = updateBrief(state, { videosPerWeek: 0, format: "bogus" as never });
    expect(unchanged.brief.videosPerWeek).toBe(4);
    expect(unchanged.brief.format).toBe("screenRecording");
    expect(updateBrief(state, { videosPerWeek: 2.5 }).brief.videosPerWeek).toBe(4);
    expect(updateBrief(state, { videosPerWeek: CREATOR_LIMITS.maxVideosPerWeek + 1 }).brief.videosPerWeek).toBe(4);
  });

  it("does not trim while typing, so spaces between words survive", () => {
    expect(updateBrief(emptyState(), { topic: "finanzas " }).brief.topic).toBe("finanzas ");
  });
});

describe("idea bank", () => {
  it("adds a trimmed idea at the top and ignores an empty title", () => {
    const state = withIdea();
    expect(state.ideas[0]).toMatchObject({ id: "i1", title: "Idea uno", note: "nota", priority: "high", status: "backlog", createdAt: NOW });
    expect(addIdea(state, { title: "   " }, "i2", NOW)).toBe(state);
    expect(addIdea(state, { title: "Otra" }, "i1", NOW)).toBe(state); // duplicate id
    expect(addIdea(state, { title: "Otra" }, "i2", NOW).ideas.map((idea) => idea.id)).toEqual(["i2", "i1"]);
  });

  it("defaults the priority and refuses ideas past the limit", () => {
    expect(addIdea(emptyState(), { title: "A", priority: "bogus" as never }, "x", NOW).ideas[0]?.priority).toBe("medium");
    let state = emptyState();
    for (let index = 0; index < CREATOR_LIMITS.ideas; index += 1) state = addIdea(state, { title: `Idea ${index}` }, `id${index}`, NOW);
    expect(state.ideas).toHaveLength(CREATOR_LIMITS.ideas);
    expect(addIdea(state, { title: "one too many" }, "extra", NOW)).toBe(state);
  });

  it("updates priority, status and text, and never blanks the title", () => {
    const state = updateIdea(withIdea(), "i1", { priority: "low", status: "discarded", note: "otra", title: "Nuevo título" });
    expect(state.ideas[0]).toMatchObject({ priority: "low", status: "discarded", note: "otra", title: "Nuevo título" });
    expect(updateIdea(state, "i1", { title: "  " }).ideas[0]?.title).toBe("Nuevo título");
    expect(updateIdea(state, "i1", { status: "bogus" as never }).ideas[0]?.status).toBe("discarded");
  });

  it("sorts high priority first and newest first inside a priority", () => {
    let state = addIdea(emptyState(), { title: "baja", priority: "low" }, "a", "2026-11-01T00:00:00Z");
    state = addIdea(state, { title: "alta vieja", priority: "high" }, "b", "2026-11-01T00:00:00Z");
    state = addIdea(state, { title: "alta nueva", priority: "high" }, "c", "2026-11-02T00:00:00Z");
    expect(sortIdeas(state.ideas).map((idea) => idea.title)).toEqual(["alta nueva", "alta vieja", "baja"]);
  });

  it("orders by the instant, not by the text, when stored timestamps use different formats", () => {
    let state = addIdea(emptyState(), { title: "vieja", priority: "high" }, "a", "2026-01-05T00:00:00.000Z");
    state = addIdea(state, { title: "nueva", priority: "high" }, "b", "Mar 3 2026 10:00:00 GMT");
    expect(sortIdeas(state.ideas).map((idea) => idea.title)).toEqual(["nueva", "vieja"]);
  });
});

describe("from idea to script", () => {
  it("creates one script draft at the first stage and marks the idea as selected", () => {
    const state = promoteIdea(withIdea(), "i1", "v1", NOW);
    expect(state.videos).toEqual([
      { id: "v1", ideaId: "i1", title: "Idea uno", hook: "", body: "", cta: "", stage: "scripting", plannedDate: null, updatedAt: NOW },
    ]);
    expect(state.ideas[0]?.status).toBe("selected");
    expect(videoOfIdea(state, "i1")?.id).toBe("v1");
  });

  it("is idempotent and ignores unknown ideas", () => {
    const once = promoteIdea(withIdea(), "i1", "v1", NOW);
    expect(promoteIdea(once, "i1", "v2", NOW)).toBe(once);
    expect(promoteIdea(once, "missing", "v3", NOW)).toBe(once);
  });

  it("keeps the script when its idea is removed, only dropping the link", () => {
    const state = removeIdea(promoteIdea(withIdea(), "i1", "v1", NOW), "i1");
    expect(state.ideas).toEqual([]);
    expect(state.videos[0]).toMatchObject({ id: "v1", ideaId: null });
  });
});

describe("script drafts and production", () => {
  const withVideo = () => promoteIdea(withIdea(), "i1", "v1", NOW);

  it("edits the sections and the planned date, refreshing updatedAt", () => {
    const later = "2026-11-03T08:00:00.000Z";
    const state = updateVideo(withVideo(), "v1", { hook: "Gancho", body: "Cuerpo", cta: "Cierre", plannedDate: "2026-11-10" }, later);
    expect(state.videos[0]).toMatchObject({ hook: "Gancho", body: "Cuerpo", cta: "Cierre", plannedDate: "2026-11-10", updatedAt: later });
  });

  it("rejects an invalid date, accepts clearing it, clamps long text and keeps the title when blanked", () => {
    const planned = updateVideo(withVideo(), "v1", { plannedDate: "2026-11-10" }, NOW);
    expect(updateVideo(planned, "v1", { plannedDate: "2026-02-30" }, NOW).videos[0]?.plannedDate).toBe("2026-11-10");
    // A patch that changes nothing is a no-op: same state, updatedAt untouched.
    expect(updateVideo(planned, "v1", { plannedDate: "2026-02-30" }, "2027-01-01T00:00:00.000Z")).toBe(planned);
    expect(updateVideo(planned, "v1", { hook: "" }, "2027-01-01T00:00:00.000Z")).toBe(planned);
    expect(updateVideo(planned, "missing", { hook: "x" }, NOW)).toBe(planned);
    expect(updateVideo(planned, "v1", { plannedDate: null }, NOW).videos[0]?.plannedDate).toBeNull();
    expect(updateVideo(planned, "v1", { body: "x".repeat(CREATOR_LIMITS.scriptSection + 50) }, NOW).videos[0]?.body).toHaveLength(CREATOR_LIMITS.scriptSection);
    expect(updateVideo(planned, "v1", { title: "   " }, NOW).videos[0]?.title).toBe("Idea uno");
  });

  it("moves through the stages in order and stops at the last one", () => {
    expect(PRODUCTION_STAGES.map((stage) => nextStage(stage))).toEqual(["voiceover", "visuals", "editing", "review", "ready", null]);
    expect(setStage(withVideo(), "v1", "editing", NOW).videos[0]?.stage).toBe("editing");
    expect(setStage(withVideo(), "v1", "bogus" as never, NOW).videos[0]?.stage).toBe("scripting");
  });

  it("counts words and estimates the narration time", () => {
    expect(scriptStats({ hook: "", body: "", cta: "" })).toEqual({ words: 0, seconds: 0 });
    expect(scriptStats({ hook: "una dos", body: "tres\ncuatro   cinco", cta: " seis " })).toEqual({ words: 6, seconds: 2 });
    const hundredFifty = Array.from({ length: 150 }, () => "palabra").join(" ");
    expect(scriptStats({ hook: hundredFifty, body: "", cta: "" })).toEqual({ words: 150, seconds: 60 });
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("removes a script and puts its selected idea back in the backlog", () => {
    const state = removeVideo(withVideo(), "v1");
    expect(state.videos).toEqual([]);
    expect(state.ideas[0]?.status).toBe("backlog");
    expect(removeVideo(state, "missing")).toBe(state);
  });

  it("does not touch the status of an idea that was discarded again after its script was written", () => {
    const discarded = updateIdea(withVideo(), "i1", { status: "discarded" });
    expect(removeVideo(discarded, "v1").ideas[0]?.status).toBe("discarded");
  });

  it("counts the videos in every stage, including the empty ones", () => {
    const counts = stageCounts(sampleState(TODAY).videos);
    expect(Object.keys(counts)).toEqual([...PRODUCTION_STAGES]);
    expect(counts).toEqual({ scripting: 1, voiceover: 1, visuals: 0, editing: 0, review: 0, ready: 1 });
  });
});

describe("production calendar", () => {
  const video = (id: string, plannedDate: string | null, stage: "scripting" | "ready" = "scripting") => ({
    id,
    ideaId: null,
    title: id,
    hook: "",
    body: "",
    cta: "",
    stage,
    plannedDate,
    updatedAt: NOW,
  });

  it("separates overdue, undated and scheduled videos and groups them by week", () => {
    const plan = planProduction(
      [video("b-late", "2026-10-30"), video("a-none", null), video("c-today", TODAY), video("d-sunday", "2026-11-08"), video("e-next", "2026-11-09"), video("f-ready-past", "2026-10-28", "ready"), video("a-late", "2026-10-30")],
      TODAY,
    );
    expect(plan.overdue.map((item) => item.id)).toEqual(["a-late", "b-late"]);
    expect(plan.unscheduled.map((item) => item.id)).toEqual(["a-none"]);
    expect(plan.weeks.map((week) => [week.weekStart, week.videos.map((item) => item.id)])).toEqual([
      ["2026-10-26", ["f-ready-past"]], // a finished video planned in the past is not overdue
      ["2026-11-02", ["c-today", "d-sunday"]],
      ["2026-11-09", ["e-next"]],
    ]);
  });

  it("returns empty groups for no videos", () => {
    expect(planProduction([], TODAY)).toEqual({ overdue: [], unscheduled: [], weeks: [] });
  });
});

describe("browser storage validation", () => {
  it("accepts the empty state and the sample, after a JSON round trip", () => {
    for (const state of [emptyState(), sampleState(TODAY)]) {
      expect(parseStudioState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    }
  });

  it("the sample is fictitious, complete and exercises every part of the studio", () => {
    const sample = sampleState(TODAY);
    expect(sample.brief.name).toMatch(/muestra/i);
    expect(sample.ideas.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sample.ideas.map((idea) => idea.status))).toEqual(new Set(["backlog", "selected", "discarded"]));
    expect(new Set(sample.videos.map((item) => item.stage)).size).toBeGreaterThan(1);
    expect(sample.videos.every((item) => item.plannedDate === null || item.plannedDate >= addDays(TODAY, -1))).toBe(true);
    expect(planProduction(sample.videos, TODAY).weeks.length).toBeGreaterThan(0);
  });

  it("repairs links between scripts and ideas instead of discarding the whole studio", () => {
    const base = JSON.parse(JSON.stringify(sampleState(TODAY)));
    const [first, second] = base.videos;
    const dangling = { ...base, videos: [{ ...first, ideaId: "does-not-exist" }, second] };
    expect(parseStudioState(dangling)?.videos[0]?.ideaId).toBeNull();

    const duplicated = { ...base, videos: [first, { ...second, ideaId: first.ideaId }] };
    const parsed = parseStudioState(duplicated);
    expect(parsed?.videos.map((video) => video.ideaId)).toEqual([first.ideaId, null]);
    expect(parseStudioState(base)?.videos.map((video) => video.ideaId)).toEqual(base.videos.map((video: { ideaId: string | null }) => video.ideaId));
  });

  it("rejects anything that is not exactly the stored shape", () => {
    const good = JSON.parse(JSON.stringify(sampleState(TODAY)));
    const mutate = (change: (state: typeof good) => void) => {
      const copy = JSON.parse(JSON.stringify(good));
      change(copy);
      return parseStudioState(copy);
    };
    for (const value of [null, undefined, "x", 1, [], {}, { version: 2 }]) expect(parseStudioState(value)).toBeNull();
    expect(mutate((state) => (state.version = 2))).toBeNull();
    expect(mutate((state) => (state.brief.format = "bogus"))).toBeNull();
    expect(mutate((state) => (state.brief.videosPerWeek = 9))).toBeNull();
    expect(mutate((state) => (state.brief.name = "x".repeat(500)))).toBeNull();
    expect(mutate((state) => (state.ideas[0].priority = "urgent"))).toBeNull();
    expect(mutate((state) => (state.ideas[0].title = "  "))).toBeNull();
    expect(mutate((state) => (state.ideas[0].createdAt = "yesterday"))).toBeNull();
    expect(mutate((state) => (state.ideas[1].id = state.ideas[0].id))).toBeNull();
    expect(mutate((state) => (state.videos[0].stage = "published"))).toBeNull();
    expect(mutate((state) => (state.videos[0].plannedDate = "2026-02-30"))).toBeNull();
    expect(mutate((state) => (state.videos[0].ideaId = 5))).toBeNull();
    expect(mutate((state) => (state.videos[0].body = "x".repeat(CREATOR_LIMITS.scriptSection + 1)))).toBeNull();
    expect(mutate((state) => (state.ideas = new Array(CREATOR_LIMITS.ideas + 1).fill(state.ideas[0])))).toBeNull();
    expect(mutate((state) => (state.videos = "nope"))).toBeNull();
  });
});
