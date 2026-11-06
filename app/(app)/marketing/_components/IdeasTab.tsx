"use client";

import { useId, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CREATOR_LIMITS, IDEA_PRIORITIES, IDEA_STATUSES, type Idea, type IdeaPriority, type IdeaStatus, type Video } from "@/lib/contracts/creator";
import { sortIdeas } from "@/lib/creator";
import type { CreatorStudioActions } from "./useCreatorStudio";
import { AREA, FIELD, LABEL, OPTION } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/Button";

type Props = {
  ideas: Idea[];
  videos: Video[];
  actions: Pick<CreatorStudioActions, "addIdea" | "updateIdea" | "removeIdea">;
  onCreateScript: (ideaId: string) => void;
  onOpenScript: (videoId: string) => void;
};

export function IdeasTab({ ideas, videos, actions, onCreateScript, onOpenScript }: Props) {
  const { m } = useI18n();
  const copy = m.creatorStudio.ideas;
  const ids = useId();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [priority, setPriority] = useState<IdeaPriority>("medium");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim() === "") return;
    actions.addIdea({ title, note, priority });
    setTitle("");
    setNote("");
    setPriority("medium");
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <div>
            <label htmlFor={`${ids}-title`} className={LABEL}>
              {copy.titleField}
            </label>
            <input id={`${ids}-title`} type="text" maxLength={CREATOR_LIMITS.ideaTitle} value={title} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
          </div>
          <div>
            <label htmlFor={`${ids}-note`} className={LABEL}>
              {copy.note}
            </label>
            <textarea id={`${ids}-note`} rows={2} maxLength={CREATOR_LIMITS.ideaNote} value={note} onChange={(event) => setNote(event.target.value)} className={AREA} />
          </div>
        </div>
        <div className="flex flex-col gap-4 sm:w-48">
          <div>
            <label htmlFor={`${ids}-priority`} className={LABEL}>
              {copy.priority}
            </label>
            <select id={`${ids}-priority`} value={priority} onChange={(event) => setPriority(event.target.value as IdeaPriority)} className={FIELD}>
              {IDEA_PRIORITIES.map((value) => (
                <option key={value} value={value} className={OPTION}>
                  {copy.priorities[value]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass("primary", "md", "min-h-11")}>
            {copy.add}
          </button>
        </div>
      </form>

      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-medium">{copy.title}</h3>
          <span className="text-sm text-ink-muted">{copy.count.replace("{count}", String(ideas.length))}</span>
        </div>

        {ideas.length === 0 ? (
          <p className="mt-4 rounded-xl border border-line bg-shade p-4 text-sm text-ink-soft">{copy.empty}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {sortIdeas(ideas).map((idea) => {
              const video = videos.find((candidate) => candidate.ideaId === idea.id);
              return (
                <li key={idea.id} className="rounded-xl border border-line bg-surface p-4">
                  <p className="font-medium text-ink">{idea.title}</p>
                  {idea.note && <p className="mt-1 text-sm text-ink-muted">{idea.note}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <select
                      aria-label={`${copy.priority}: ${idea.title}`}
                      value={idea.priority}
                      onChange={(event) => actions.updateIdea(idea.id, { priority: event.target.value as IdeaPriority })}
                      className={`${FIELD} w-auto`}
                    >
                      {IDEA_PRIORITIES.map((value) => (
                        <option key={value} value={value} className={OPTION}>
                          {copy.priorities[value]}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${copy.status}: ${idea.title}`}
                      value={idea.status}
                      onChange={(event) => actions.updateIdea(idea.id, { status: event.target.value as IdeaStatus })}
                      className={`${FIELD} w-auto`}
                    >
                      {IDEA_STATUSES.map((value) => (
                        <option key={value} value={value} className={OPTION}>
                          {copy.statuses[value]}
                        </option>
                      ))}
                    </select>
                    {video ? (
                      <button type="button" onClick={() => onOpenScript(video.id)} className={buttonClass("secondary", "md", "min-h-11")}>
                        {copy.openScript}
                      </button>
                    ) : (
                      <button type="button" onClick={() => onCreateScript(idea.id)} disabled={idea.status === "discarded" || videos.length >= CREATOR_LIMITS.videos} className={buttonClass("primary", "md", "min-h-11")}>
                        {copy.promote}
                      </button>
                    )}
                    <button type="button" onClick={() => actions.removeIdea(idea.id)} aria-label={`${copy.remove}: ${idea.title}`} className={buttonClass("secondary", "md", "min-h-11")}>
                      {copy.remove}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
