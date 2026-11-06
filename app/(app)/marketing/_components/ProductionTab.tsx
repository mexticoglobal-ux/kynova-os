"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import { PRODUCTION_STAGES, type ProductionStage, type Video } from "@/lib/contracts/creator";
import { localToday, nextStage, planProduction, stageCounts } from "@/lib/creator";
import type { CreatorStudioActions } from "./useCreatorStudio";
import { FIELD, OPTION } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/Button";

type Props = {
  videos: Video[];
  onOpen: (videoId: string) => void;
  actions: Pick<CreatorStudioActions, "setStage">;
};

// Dates are plain YYYY-MM-DD values; they are formatted in UTC so a date never shifts by time zone.
function formatDate(date: string, tag: string): string {
  return new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function ProductionRow({ video, onOpen, actions }: { video: Video } & Pick<Props, "onOpen" | "actions">) {
  const { m, tag } = useI18n();
  const copy = m.creatorStudio.production;
  const following = nextStage(video.stage);

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink">{video.title}</p>
        <p className="text-xs text-ink-muted">{video.plannedDate ? formatDate(video.plannedDate, tag) : copy.unscheduled}</p>
      </div>
      <select
        aria-label={`${m.creatorStudio.scripts.stage}: ${video.title}`}
        value={video.stage}
        onChange={(event) => actions.setStage(video.id, event.target.value as ProductionStage)}
        className={`${FIELD} w-auto`}
      >
        {PRODUCTION_STAGES.map((stage) => (
          <option key={stage} value={stage} className={OPTION}>
            {copy.stages[stage]}
          </option>
        ))}
      </select>
      {following && (
        <button type="button" onClick={() => actions.setStage(video.id, following)} aria-label={`${copy.advance}: ${video.title}`} className={buttonClass("secondary", "md", "min-h-11")}>
          {copy.advance}
        </button>
      )}
      <button type="button" onClick={() => onOpen(video.id)} aria-label={`${copy.open}: ${video.title}`} className={buttonClass("secondary", "md", "min-h-11")}>
        {copy.open}
      </button>
    </li>
  );
}

export function ProductionTab({ videos, onOpen, actions }: Props) {
  const { m, tag } = useI18n();
  const copy = m.creatorStudio.production;
  const counts = stageCounts(videos);
  const plan = planProduction(videos, localToday());

  const groups: Array<{ key: string; title: string; videos: Video[]; tone?: string }> = [
    { key: "overdue", title: copy.overdue, videos: plan.overdue, tone: "text-danger-soft" },
    { key: "unscheduled", title: copy.unscheduled, videos: plan.unscheduled },
    ...plan.weeks.map((week) => ({ key: week.weekStart, title: copy.weekOf.replace("{date}", formatDate(week.weekStart, tag)), videos: week.videos })),
  ];

  return (
    <div className="space-y-6">
      <h3 className="font-medium">{copy.title}</h3>

      <section aria-label={copy.summary}>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {PRODUCTION_STAGES.map((stage) => (
            <li key={stage} className="rounded-xl border border-line bg-shade p-3 text-center">
              <p className="text-2xl font-semibold tabular-nums">{counts[stage]}</p>
              <p className="text-xs text-ink-muted">{copy.stages[stage]}</p>
            </li>
          ))}
        </ul>
      </section>

      {videos.length === 0 ? (
        <p className="rounded-xl border border-line bg-shade p-4 text-sm text-ink-soft">{copy.empty}</p>
      ) : (
        groups
          .filter((group) => group.videos.length > 0)
          .map((group) => (
            <section key={group.key} aria-label={group.title}>
              <h4 className={`mb-2 text-sm font-medium ${group.tone ?? "text-ink-soft"}`}>{group.title}</h4>
              <ul className="space-y-2">
                {group.videos.map((video) => (
                  <ProductionRow key={video.id} video={video} onOpen={onOpen} actions={actions} />
                ))}
              </ul>
            </section>
          ))
      )}

      <p className="text-xs text-ink-muted">{copy.note}</p>
    </div>
  );
}
