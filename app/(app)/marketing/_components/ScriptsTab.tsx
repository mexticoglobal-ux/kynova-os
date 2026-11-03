"use client";

import { useId, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CREATOR_LIMITS, PRODUCTION_STAGES, type ProductionStage, type Video } from "@/lib/contracts/creator";
import { formatDuration, scriptStats } from "@/lib/creator";
import type { CreatorStudioActions } from "./useCreatorStudio";
import { AREA, BUTTON_GHOST, BUTTON_PRIMARY, FIELD, LABEL, OPTION } from "./styles";

type Props = {
  videos: Video[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGoIdeas: () => void;
  actions: Pick<CreatorStudioActions, "updateVideo" | "setStage" | "removeVideo">;
};

// A title can never be empty, but the field has to let it be cleared while retyping: it keeps a local draft and
// only saves non-empty values; on blur it goes back to the saved title.
function TitleField({ id, title, onCommit }: { id: string; title: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="text"
      maxLength={CREATOR_LIMITS.videoTitle}
      value={draft ?? title}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() !== "") onCommit(event.target.value);
      }}
      onBlur={() => setDraft(null)}
      className={FIELD}
    />
  );
}

export function ScriptsTab({ videos, selectedId, onSelect, onGoIdeas, actions }: Props) {
  const { m } = useI18n();
  const copy = m.creatorStudio.scripts;
  const stages = m.creatorStudio.production.stages;
  const ids = useId();
  const video = videos.find((candidate) => candidate.id === selectedId) ?? videos[0];

  if (!video) {
    return (
      <div className="space-y-4">
        <h3 className="font-medium">{copy.title}</h3>
        <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">{copy.empty}</p>
        <button type="button" onClick={onGoIdeas} className={BUTTON_PRIMARY}>
          {copy.goIdeas}
        </button>
      </div>
    );
  }

  const { words, seconds } = scriptStats(video);

  return (
    <div className="space-y-5">
      <h3 className="font-medium">{copy.title}</h3>
      <div>
        <label htmlFor={`${ids}-pick`} className={LABEL}>
          {copy.pick}
        </label>
        <select id={`${ids}-pick`} value={video.id} onChange={(event) => onSelect(event.target.value)} className={FIELD}>
          {videos.map((candidate) => (
            <option key={candidate.id} value={candidate.id} className={OPTION}>
              {candidate.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-name`} className={LABEL}>
            {copy.name}
          </label>
          <TitleField key={video.id} id={`${ids}-name`} title={video.title} onCommit={(title) => actions.updateVideo(video.id, { title })} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-hook`} className={LABEL}>
            {copy.hook}
          </label>
          <textarea
            id={`${ids}-hook`}
            rows={3}
            maxLength={CREATOR_LIMITS.scriptSection}
            value={video.hook}
            onChange={(event) => actions.updateVideo(video.id, { hook: event.target.value })}
            className={AREA}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-body`} className={LABEL}>
            {copy.body}
          </label>
          <textarea
            id={`${ids}-body`}
            rows={8}
            maxLength={CREATOR_LIMITS.scriptSection}
            value={video.body}
            onChange={(event) => actions.updateVideo(video.id, { body: event.target.value })}
            className={AREA}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-cta`} className={LABEL}>
            {copy.cta}
          </label>
          <textarea
            id={`${ids}-cta`}
            rows={3}
            maxLength={CREATOR_LIMITS.scriptSection}
            value={video.cta}
            onChange={(event) => actions.updateVideo(video.id, { cta: event.target.value })}
            className={AREA}
          />
        </div>
        <div>
          <label htmlFor={`${ids}-stage`} className={LABEL}>
            {copy.stage}
          </label>
          <select id={`${ids}-stage`} value={video.stage} onChange={(event) => actions.setStage(video.id, event.target.value as ProductionStage)} className={FIELD}>
            {PRODUCTION_STAGES.map((stage) => (
              <option key={stage} value={stage} className={OPTION}>
                {stages[stage]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-planned`} className={LABEL}>
            {copy.planned}
          </label>
          <input
            id={`${ids}-planned`}
            type="date"
            value={video.plannedDate ?? ""}
            onChange={(event) => actions.updateVideo(video.id, { plannedDate: event.target.value === "" ? null : event.target.value })}
            className={FIELD}
          />
        </div>
      </div>

      <p role="status" className="text-sm text-zinc-300">
        <span className="font-medium text-zinc-100">{words}</span> {copy.words} · {copy.duration}: <span className="font-medium text-zinc-100">{formatDuration(seconds)}</span>
      </p>

      <button type="button" onClick={() => actions.removeVideo(video.id)} className={BUTTON_GHOST}>
        {copy.remove}
      </button>
    </div>
  );
}
