// Creator studio v0 (Marketing): a faceless YouTube channel workspace that lives only in the browser.
// Nothing here talks to YouTube or any server; the contract just fixes the shape of the local state.

export const FACELESS_FORMATS = ["narratedStock", "screenRecording", "slidesAnimation", "ttsCompilation"] as const;
export type FacelessFormat = (typeof FACELESS_FORMATS)[number];

export const IDEA_PRIORITIES = ["high", "medium", "low"] as const;
export type IdeaPriority = (typeof IDEA_PRIORITIES)[number];

export const IDEA_STATUSES = ["backlog", "selected", "discarded"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

// Production pipeline of a faceless video, in order.
export const PRODUCTION_STAGES = ["scripting", "voiceover", "visuals", "editing", "review", "ready"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const CREATOR_LIMITS = {
  name: 80,
  topic: 200,
  audience: 300,
  tone: 120,
  ideaTitle: 120,
  ideaNote: 500,
  videoTitle: 120,
  scriptSection: 4000,
  id: 64,
  ideas: 100,
  videos: 50,
  maxVideosPerWeek: 7,
} as const;

export type ChannelBrief = {
  name: string;
  topic: string;
  audience: string;
  tone: string;
  format: FacelessFormat;
  videosPerWeek: number;
};

export type Idea = {
  id: string;
  title: string;
  note: string;
  priority: IdeaPriority;
  status: IdeaStatus;
  createdAt: string;
};

// A video is a script draft plus its place in production. `plannedDate` is a plain YYYY-MM-DD planning
// date: it never schedules or publishes anything.
export type Video = {
  id: string;
  ideaId: string | null;
  title: string;
  hook: string;
  body: string;
  cta: string;
  stage: ProductionStage;
  plannedDate: string | null;
  updatedAt: string;
};

export type CreatorStudioState = {
  version: 1;
  brief: ChannelBrief;
  ideas: Idea[];
  videos: Video[];
};

export type ProductionPlan = {
  overdue: Video[];
  unscheduled: Video[];
  weeks: Array<{ weekStart: string; videos: Video[] }>;
};
