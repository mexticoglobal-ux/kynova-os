"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { EMPTY_BRIEF, videoOfIdea } from "@/lib/creator";
import { BriefTab } from "./BriefTab";
import { IdeasTab } from "./IdeasTab";
import { ProductionTab } from "./ProductionTab";
import { ScriptsTab } from "./ScriptsTab";
import { buttonClass } from "@/components/ui/Button";
import { useCreatorStudio } from "./useCreatorStudio";
import { Badge } from "@/components/ui/Badge";

// Creator studio v0 inside Marketing (ADR-0005: a module view of its own lives in _components/). A faceless
// YouTube channel workspace that is local to this browser: it connects to no service and publishes nothing.

const TABS = ["brief", "ideas", "scripts", "production"] as const;
type Tab = (typeof TABS)[number];

export function CreatorStudio() {
  const { m } = useI18n();
  const copy = m.creatorStudio;
  const ids = useId();
  const { state, ready, actions } = useCreatorStudio();
  const [tab, setTab] = useState<Tab>("brief");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Untouched means nothing typed and nothing chosen: loading the sample replaces the studio, so any work counts.
  const isEmpty =
    state.ideas.length === 0 &&
    state.videos.length === 0 &&
    [state.brief.name, state.brief.topic, state.brief.audience, state.brief.tone].every((text) => text === "") &&
    state.brief.format === EMPTY_BRIEF.format &&
    state.brief.videosPerWeek === EMPTY_BRIEF.videosPerWeek;

  function openScript(id: string) {
    setVideoId(id);
    setTab("scripts");
  }

  function createScript(ideaId: string) {
    const existing = videoOfIdea(state, ideaId);
    openScript(existing?.id ?? actions.createScript(ideaId));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = TABS.indexOf(current);
    const target = { ArrowRight: TABS[(index + 1) % TABS.length], ArrowLeft: TABS[(index + TABS.length - 1) % TABS.length], Home: TABS[0], End: TABS[TABS.length - 1] }[event.key];
    if (!target) return;
    event.preventDefault();
    setTab(target);
    document.getElementById(`${ids}-tab-${target}`)?.focus();
  }

  return (
    <section className="card animate-fade-up p-5 sm:p-6" aria-labelledby={`${ids}-title`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {copy.title}
        </h2>
        <Badge tone="primary">{copy.tag}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{copy.subtitle}</p>
      <p className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm text-ink-soft">{copy.notice}</p>

      {!ready ? (
        <p role="status" className="mt-5 text-sm text-ink-muted">
          {m.common.loading}
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isEmpty && (
              <button type="button" onClick={actions.loadSample} className={buttonClass("primary", "md", "min-h-11")}>
                {copy.loadSample}
              </button>
            )}
            {!isEmpty &&
              (confirmingReset ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      actions.reset();
                      setConfirmingReset(false);
                      setVideoId(null);
                      setTab("brief");
                    }}
                    className={buttonClass("primary", "md", "min-h-11")}
                  >
                    {copy.resetConfirm}
                  </button>
                  <button type="button" onClick={() => setConfirmingReset(false)} className={buttonClass("secondary", "md", "min-h-11")}>
                    {copy.resetCancel}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmingReset(true)} className={buttonClass("secondary", "md", "min-h-11")}>
                  {copy.reset}
                </button>
              ))}
          </div>

          <div role="tablist" aria-label={copy.tabsLabel} className="mt-5 flex flex-wrap gap-2 border-b border-line pb-3">
            {TABS.map((name) => (
              <button
                key={name}
                id={`${ids}-tab-${name}`}
                type="button"
                role="tab"
                aria-selected={tab === name}
                aria-controls={`${ids}-panel-${name}`}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(event) => onTabKeyDown(event, name)}
                className={buttonClass(tab === name ? "primary" : "secondary", "md", "min-h-11")}
              >
                {copy.tabs[name]}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`${ids}-panel-${tab}`} aria-labelledby={`${ids}-tab-${tab}`} className="mt-5">
            {tab === "brief" && <BriefTab brief={state.brief} onChange={actions.updateBrief} />}
            {tab === "ideas" && (
              <IdeasTab ideas={state.ideas} videos={state.videos} actions={actions} onCreateScript={createScript} onOpenScript={openScript} />
            )}
            {tab === "scripts" && (
              <ScriptsTab videos={state.videos} selectedId={videoId} onSelect={setVideoId} onGoIdeas={() => setTab("ideas")} actions={actions} />
            )}
            {tab === "production" && <ProductionTab videos={state.videos} onOpen={openScript} actions={actions} />}
          </div>
        </>
      )}
    </section>
  );
}
