"use client";

import { useId } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { CREATOR_LIMITS, FACELESS_FORMATS, type ChannelBrief, type FacelessFormat } from "@/lib/contracts/creator";
import { AREA, FIELD, LABEL, OPTION } from "./styles";

const CADENCES = Array.from({ length: CREATOR_LIMITS.maxVideosPerWeek }, (_, index) => index + 1);

export function BriefTab({ brief, onChange }: { brief: ChannelBrief; onChange: (patch: Partial<ChannelBrief>) => void }) {
  const { m } = useI18n();
  const copy = m.creatorStudio.brief;
  const ids = useId();

  return (
    <form onSubmit={(event) => event.preventDefault()} className="space-y-4">
      <h3 className="font-medium">{copy.title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${ids}-name`} className={LABEL}>
            {copy.name}
          </label>
          <input id={`${ids}-name`} type="text" maxLength={CREATOR_LIMITS.name} value={brief.name} onChange={(event) => onChange({ name: event.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${ids}-topic`} className={LABEL}>
            {copy.topic}
          </label>
          <input id={`${ids}-topic`} type="text" maxLength={CREATOR_LIMITS.topic} value={brief.topic} onChange={(event) => onChange({ topic: event.target.value })} className={FIELD} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${ids}-audience`} className={LABEL}>
            {copy.audience}
          </label>
          <textarea id={`${ids}-audience`} rows={3} maxLength={CREATOR_LIMITS.audience} value={brief.audience} onChange={(event) => onChange({ audience: event.target.value })} className={AREA} />
        </div>
        <div>
          <label htmlFor={`${ids}-tone`} className={LABEL}>
            {copy.tone}
          </label>
          <input id={`${ids}-tone`} type="text" maxLength={CREATOR_LIMITS.tone} value={brief.tone} onChange={(event) => onChange({ tone: event.target.value })} className={FIELD} />
        </div>
        <div>
          <label htmlFor={`${ids}-format`} className={LABEL}>
            {copy.format}
          </label>
          <select id={`${ids}-format`} value={brief.format} onChange={(event) => onChange({ format: event.target.value as FacelessFormat })} className={FIELD}>
            {FACELESS_FORMATS.map((format) => (
              <option key={format} value={format} className={OPTION}>
                {copy.formats[format]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-cadence`} className={LABEL}>
            {copy.cadence}
          </label>
          <select id={`${ids}-cadence`} value={brief.videosPerWeek} onChange={(event) => onChange({ videosPerWeek: Number(event.target.value) })} className={FIELD}>
            {CADENCES.map((count) => (
              <option key={count} value={count} className={OPTION}>
                {count}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-zinc-400">{copy.saveHint}</p>
    </form>
  );
}
