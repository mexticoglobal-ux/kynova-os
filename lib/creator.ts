// Pure logic of the creator studio (Marketing, v0). No React, no storage, no network: the UI and the
// browser storage hook call these functions, and every function returns a new state.

import {
  CREATOR_LIMITS,
  FACELESS_FORMATS,
  IDEA_PRIORITIES,
  IDEA_STATUSES,
  PRODUCTION_STAGES,
  type ChannelBrief,
  type CreatorStudioState,
  type Idea,
  type IdeaPriority,
  type ProductionPlan,
  type ProductionStage,
  type Video,
} from "@/lib/contracts/creator";

export const WORDS_PER_MINUTE = 150; // calm narration pace, used for the estimated length

// ---------------------------------------------------------------------------------------------------------
// Dates: plain YYYY-MM-DD strings, computed in UTC so the result never depends on the time zone.
// ---------------------------------------------------------------------------------------------------------

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** The Monday of the week that contains `date`. */
export function weekStart(date: string): string {
  const day = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -day);
}

/** Today in the user's local calendar, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------

export const EMPTY_BRIEF: ChannelBrief = { name: "", topic: "", audience: "", tone: "", format: "narratedStock", videosPerWeek: 2 };

export function emptyState(): CreatorStudioState {
  return { version: 1, brief: { ...EMPTY_BRIEF }, ideas: [], videos: [] };
}

const clamp = (value: string, max: number) => value.slice(0, max);

function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= CREATOR_LIMITS.id;
}

const includes = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

function parseBrief(value: unknown): ChannelBrief | null {
  if (typeof value !== "object" || value === null) return null;
  const brief = value as Record<string, unknown>;
  if (
    !isText(brief.name, CREATOR_LIMITS.name) ||
    !isText(brief.topic, CREATOR_LIMITS.topic) ||
    !isText(brief.audience, CREATOR_LIMITS.audience) ||
    !isText(brief.tone, CREATOR_LIMITS.tone) ||
    !includes(FACELESS_FORMATS, brief.format) ||
    typeof brief.videosPerWeek !== "number" ||
    !Number.isInteger(brief.videosPerWeek) ||
    brief.videosPerWeek < 1 ||
    brief.videosPerWeek > CREATOR_LIMITS.maxVideosPerWeek
  ) {
    return null;
  }
  return { name: brief.name, topic: brief.topic, audience: brief.audience, tone: brief.tone, format: brief.format, videosPerWeek: brief.videosPerWeek };
}

function parseIdea(value: unknown): Idea | null {
  if (typeof value !== "object" || value === null) return null;
  const idea = value as Record<string, unknown>;
  if (
    !isId(idea.id) ||
    !isText(idea.title, CREATOR_LIMITS.ideaTitle) ||
    idea.title.trim() === "" ||
    !isText(idea.note, CREATOR_LIMITS.ideaNote) ||
    !includes(IDEA_PRIORITIES, idea.priority) ||
    !includes(IDEA_STATUSES, idea.status) ||
    !isTimestamp(idea.createdAt)
  ) {
    return null;
  }
  return { id: idea.id, title: idea.title, note: idea.note, priority: idea.priority, status: idea.status, createdAt: idea.createdAt };
}

function parseVideo(value: unknown): Video | null {
  if (typeof value !== "object" || value === null) return null;
  const video = value as Record<string, unknown>;
  if (
    !isId(video.id) ||
    !(video.ideaId === null || isId(video.ideaId)) ||
    !isText(video.title, CREATOR_LIMITS.videoTitle) ||
    video.title.trim() === "" ||
    !isText(video.hook, CREATOR_LIMITS.scriptSection) ||
    !isText(video.body, CREATOR_LIMITS.scriptSection) ||
    !isText(video.cta, CREATOR_LIMITS.scriptSection) ||
    !includes(PRODUCTION_STAGES, video.stage) ||
    !(video.plannedDate === null || isIsoDate(video.plannedDate)) ||
    !isTimestamp(video.updatedAt)
  ) {
    return null;
  }
  return {
    id: video.id,
    ideaId: video.ideaId,
    title: video.title,
    hook: video.hook,
    body: video.body,
    cta: video.cta,
    stage: video.stage,
    plannedDate: video.plannedDate,
    updatedAt: video.updatedAt,
  };
}

function parseAll<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (!parsed) return null;
    items.push(parsed);
  }
  return items;
}

/** Validates what was read from browser storage. Anything unexpected gives null: it is never trusted. */
export function parseStudioState(value: unknown): CreatorStudioState | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;

  const brief = parseBrief(raw.brief);
  const ideas = parseAll(raw.ideas, CREATOR_LIMITS.ideas, parseIdea);
  const videos = parseAll(raw.videos, CREATOR_LIMITS.videos, parseVideo);
  if (!brief || !ideas || !videos) return null;

  const unique = (items: Array<{ id: string }>) => new Set(items.map((item) => item.id)).size === items.length;
  if (!unique(ideas) || !unique(videos)) return null;

  // One script per idea: a link to an idea that no longer exists, or a second script for the same idea, is repaired
  // by dropping the link instead of discarding the whole studio.
  const ideaIds = new Set(ideas.map((idea) => idea.id));
  const linked = new Set<string>();
  const repaired = videos.map((video) => {
    if (video.ideaId === null) return video;
    if (!ideaIds.has(video.ideaId) || linked.has(video.ideaId)) return { ...video, ideaId: null };
    linked.add(video.ideaId);
    return video;
  });

  return { version: 1, brief, ideas, videos: repaired };
}

// ---------------------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------------------

export function updateBrief(state: CreatorStudioState, patch: Partial<ChannelBrief>): CreatorStudioState {
  const current = state.brief;
  const next: ChannelBrief = {
    name: patch.name === undefined ? current.name : clamp(patch.name, CREATOR_LIMITS.name),
    topic: patch.topic === undefined ? current.topic : clamp(patch.topic, CREATOR_LIMITS.topic),
    audience: patch.audience === undefined ? current.audience : clamp(patch.audience, CREATOR_LIMITS.audience),
    tone: patch.tone === undefined ? current.tone : clamp(patch.tone, CREATOR_LIMITS.tone),
    format: includes(FACELESS_FORMATS, patch.format) ? patch.format : current.format,
    videosPerWeek:
      typeof patch.videosPerWeek === "number" &&
      Number.isInteger(patch.videosPerWeek) &&
      patch.videosPerWeek >= 1 &&
      patch.videosPerWeek <= CREATOR_LIMITS.maxVideosPerWeek
        ? patch.videosPerWeek
        : current.videosPerWeek,
  };
  return { ...state, brief: next };
}

export function addIdea(
  state: CreatorStudioState,
  input: { title: string; note?: string; priority?: IdeaPriority },
  id: string,
  now: string,
): CreatorStudioState {
  const title = clamp(input.title.trim(), CREATOR_LIMITS.ideaTitle);
  if (title === "" || state.ideas.length >= CREATOR_LIMITS.ideas || state.ideas.some((idea) => idea.id === id)) return state;
  const idea: Idea = {
    id,
    title,
    note: clamp((input.note ?? "").trim(), CREATOR_LIMITS.ideaNote),
    priority: includes(IDEA_PRIORITIES, input.priority) ? input.priority : "medium",
    status: "backlog",
    createdAt: now,
  };
  return { ...state, ideas: [idea, ...state.ideas] };
}

export function updateIdea(
  state: CreatorStudioState,
  id: string,
  patch: Partial<Pick<Idea, "title" | "note" | "priority" | "status">>,
): CreatorStudioState {
  return {
    ...state,
    ideas: state.ideas.map((idea) => {
      if (idea.id !== id) return idea;
      return {
        ...idea,
        title: patch.title === undefined || patch.title.trim() === "" ? idea.title : clamp(patch.title, CREATOR_LIMITS.ideaTitle),
        note: patch.note === undefined ? idea.note : clamp(patch.note, CREATOR_LIMITS.ideaNote),
        priority: includes(IDEA_PRIORITIES, patch.priority) ? patch.priority : idea.priority,
        status: includes(IDEA_STATUSES, patch.status) ? patch.status : idea.status,
      };
    }),
  };
}

/** Removing an idea keeps the scripts already written from it: they just lose the link. */
export function removeIdea(state: CreatorStudioState, id: string): CreatorStudioState {
  return {
    ...state,
    ideas: state.ideas.filter((idea) => idea.id !== id),
    videos: state.videos.map((video) => (video.ideaId === id ? { ...video, ideaId: null } : video)),
  };
}

export const videoOfIdea = (state: CreatorStudioState, ideaId: string): Video | undefined => state.videos.find((video) => video.ideaId === ideaId);

/** Turns an idea into a script draft at the first stage. Idempotent: an idea gets one script. */
export function promoteIdea(state: CreatorStudioState, ideaId: string, videoId: string, now: string): CreatorStudioState {
  const idea = state.ideas.find((candidate) => candidate.id === ideaId);
  if (!idea || videoOfIdea(state, ideaId) || state.videos.length >= CREATOR_LIMITS.videos || state.videos.some((video) => video.id === videoId)) return state;

  const video: Video = {
    id: videoId,
    ideaId,
    title: clamp(idea.title, CREATOR_LIMITS.videoTitle),
    hook: "",
    body: "",
    cta: "",
    stage: "scripting",
    plannedDate: null,
    updatedAt: now,
  };
  return {
    ...state,
    ideas: state.ideas.map((candidate) => (candidate.id === ideaId ? { ...candidate, status: "selected" } : candidate)),
    videos: [...state.videos, video],
  };
}

/** A patch that changes nothing (for example an invalid date) returns the same state and leaves updatedAt alone. */
export function updateVideo(
  state: CreatorStudioState,
  id: string,
  patch: Partial<Pick<Video, "title" | "hook" | "body" | "cta">> & { plannedDate?: string | null },
  now: string,
): CreatorStudioState {
  let changed = false;
  const videos = state.videos.map((video) => {
    if (video.id !== id) return video;
    const next: Video = {
      ...video,
      title: patch.title === undefined || patch.title.trim() === "" ? video.title : clamp(patch.title, CREATOR_LIMITS.videoTitle),
      hook: patch.hook === undefined ? video.hook : clamp(patch.hook, CREATOR_LIMITS.scriptSection),
      body: patch.body === undefined ? video.body : clamp(patch.body, CREATOR_LIMITS.scriptSection),
      cta: patch.cta === undefined ? video.cta : clamp(patch.cta, CREATOR_LIMITS.scriptSection),
      plannedDate: patch.plannedDate === undefined ? video.plannedDate : patch.plannedDate === null || isIsoDate(patch.plannedDate) ? patch.plannedDate : video.plannedDate,
    };
    if (next.title === video.title && next.hook === video.hook && next.body === video.body && next.cta === video.cta && next.plannedDate === video.plannedDate) return video;
    changed = true;
    return { ...next, updatedAt: now };
  });
  return changed ? { ...state, videos } : state;
}

export function setStage(state: CreatorStudioState, id: string, stage: ProductionStage, now: string): CreatorStudioState {
  if (!includes(PRODUCTION_STAGES, stage)) return state;
  return { ...state, videos: state.videos.map((video) => (video.id === id ? { ...video, stage, updatedAt: now } : video)) };
}

export function nextStage(stage: ProductionStage): ProductionStage | null {
  return PRODUCTION_STAGES[PRODUCTION_STAGES.indexOf(stage) + 1] ?? null;
}

/** Deleting the script of a selected idea puts the idea back in the backlog, so the two never drift apart. */
export function removeVideo(state: CreatorStudioState, id: string): CreatorStudioState {
  const removed = state.videos.find((video) => video.id === id);
  if (!removed) return state;

  const videos = state.videos.filter((video) => video.id !== id);
  const ideaId = removed.ideaId;
  const ideas =
    ideaId !== null && !videos.some((video) => video.ideaId === ideaId)
      ? state.ideas.map((idea) => (idea.id === ideaId && idea.status === "selected" ? { ...idea, status: "backlog" as const } : idea))
      : state.ideas;
  return { ...state, ideas, videos };
}

// ---------------------------------------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------------------------------------

/** Word count and estimated narration time of a script. */
export function scriptStats(video: Pick<Video, "hook" | "body" | "cta">): { words: number; seconds: number } {
  const words = [video.hook, video.body, video.cta].join(" ").split(/\s+/).filter(Boolean).length;
  return { words, seconds: Math.round((words / WORDS_PER_MINUTE) * 60) };
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function stageCounts(videos: readonly Video[]): Record<ProductionStage, number> {
  const counts = Object.fromEntries(PRODUCTION_STAGES.map((stage) => [stage, 0])) as Record<ProductionStage, number>;
  for (const video of videos) counts[video.stage] += 1;
  return counts;
}

const byDateThenTitle = (a: Video, b: Video) => (a.plannedDate ?? "").localeCompare(b.plannedDate ?? "") || a.title.localeCompare(b.title);

/**
 * Splits the videos for the production calendar: planned before today and not ready yet (overdue), without a
 * date, and the rest grouped by week (Monday start), oldest week first.
 */
export function planProduction(videos: readonly Video[], today: string): ProductionPlan {
  const overdue: Video[] = [];
  const unscheduled: Video[] = [];
  const byWeek = new Map<string, Video[]>();

  for (const video of videos) {
    if (video.plannedDate === null) {
      unscheduled.push(video);
    } else if (video.plannedDate < today && video.stage !== "ready") {
      overdue.push(video);
    } else {
      const key = weekStart(video.plannedDate);
      byWeek.set(key, [...(byWeek.get(key) ?? []), video]);
    }
  }

  return {
    overdue: overdue.sort(byDateThenTitle),
    unscheduled: unscheduled.sort((a, b) => a.title.localeCompare(b.title)),
    weeks: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, items]) => ({ weekStart: key, videos: items.sort(byDateThenTitle) })),
  };
}

const PRIORITY_ORDER: Record<IdeaPriority, number> = { high: 0, medium: 1, low: 2 };

/** Ideas to work on first: high priority first, newest first inside each priority. */
export function sortIdeas(ideas: readonly Idea[]): Idea[] {
  // Compare instants, not strings: stored timestamps only have to be parseable, not in one format.
  return [...ideas].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// ---------------------------------------------------------------------------------------------------------
// Sample content (Spanish, fictitious): a made-up personal-finance channel so the flow can be tried end to end.
// It contains no real clients and no real channel, and it is not financial advice.
// ---------------------------------------------------------------------------------------------------------

export function sampleState(today: string): CreatorStudioState {
  const at = (offset: number) => `${addDays(today, offset)}T09:00:00.000Z`;
  return {
    version: 1,
    brief: {
      name: "Finanzas Claras (canal de muestra)",
      topic: "Finanzas personales para jóvenes profesionales de Latinoamérica",
      audience: "Personas de 22 a 35 años que quieren ordenar su dinero y empezar a ahorrar, sin tecnicismos.",
      tone: "Cercano, claro y con ejemplos cotidianos",
      format: "narratedStock",
      videosPerWeek: 2,
    },
    ideas: [
      { id: "sample-idea-1", title: "Cómo armar tu primer presupuesto en 15 minutos", note: "Gancho: «Si no sabes en qué se va tu sueldo, empieza aquí».", priority: "high", status: "selected", createdAt: at(-9) },
      { id: "sample-idea-2", title: "Los 5 gastos hormiga que no notas", note: "Lista corta con un ejemplo de cuánto suman al año.", priority: "high", status: "selected", createdAt: at(-8) },
      { id: "sample-idea-3", title: "Fondo de emergencia: cuánto necesitas de verdad", note: "Comparar 3 meses frente a 6 meses según el tipo de empleo.", priority: "medium", status: "backlog", createdAt: at(-7) },
      { id: "sample-idea-4", title: "Errores comunes de quien usa su primera tarjeta de crédito", note: "Mostrar el efecto de pagar solo el mínimo.", priority: "medium", status: "backlog", createdAt: at(-6) },
      { id: "sample-idea-5", title: "La regla 50/30/20 explicada con un sueldo de ejemplo", note: "Usar una hoja de cálculo en pantalla.", priority: "medium", status: "backlog", createdAt: at(-5) },
      { id: "sample-idea-6", title: "Tres mitos del dinero que te frenan", note: "Formato de mito frente a realidad.", priority: "low", status: "backlog", createdAt: at(-4) },
      { id: "sample-idea-7", title: "Suscripciones olvidadas: cómo encontrarlas", note: "Revisar el estado de cuenta paso a paso.", priority: "low", status: "discarded", createdAt: at(-3) },
    ],
    videos: [
      {
        id: "sample-video-1",
        ideaId: "sample-idea-1",
        title: "Cómo armar tu primer presupuesto en 15 minutos",
        hook: "Si cada fin de mes te preguntas en qué se fue tu sueldo, este vídeo es para ti. En quince minutos vas a tener tu primer presupuesto.",
        body: "Paso uno: anota tus ingresos reales del mes. Paso dos: lista tus gastos fijos, como renta, servicios y transporte. Paso tres: separa lo variable, comida y ocio. Paso cuatro: decide cuánto quieres ahorrar antes de gastar, no después.",
        cta: "Si te sirvió, descarga la plantilla de la descripción y cuéntame en los comentarios cuál es tu mayor gasto.",
        stage: "voiceover",
        plannedDate: addDays(today, 3),
        updatedAt: at(-2),
      },
      {
        id: "sample-video-2",
        ideaId: "sample-idea-2",
        title: "Los 5 gastos hormiga que no notas",
        hook: "Un café, un snack y una suscripción: pequeñas compras que, sumadas, pueden pesar más que tu renta.",
        body: "",
        cta: "",
        stage: "scripting",
        plannedDate: addDays(today, 7),
        updatedAt: at(-1),
      },
      {
        id: "sample-video-3",
        ideaId: null,
        title: "Presentación del canal",
        hook: "Bienvenido a Finanzas Claras, el canal donde el dinero se explica sin complicaciones.",
        body: "Cada semana publicaremos dos vídeos cortos con ejemplos reales y plantillas gratuitas.",
        cta: "Suscríbete para no perderte el primer vídeo.",
        stage: "ready",
        plannedDate: addDays(today, 1),
        updatedAt: at(0),
      },
    ],
  };
}
