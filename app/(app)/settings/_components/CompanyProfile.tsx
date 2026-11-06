"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { ASSESSMENT_OPTIONS, ASSESSMENT_QUESTIONS, type AssessmentQuestion } from "@/lib/contracts/assessment";
import { TENANT_ROLES, isUuid, parseBusinessProfileInput, type BusinessProfileInput, type TenantRole } from "@/lib/contracts/tenancy";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";
import { ROLE_LABEL } from "@/lib/contracts/backend";
import { FIELD_LG, LABEL } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

// Company profile v1 (ADR-0006, phase 2): reads and writes only through GET/PUT /api/profile. The tenant and
// the author never travel from here: the server takes them from the session.

type Tenant = { id: string; name: string; role: TenantRole };
type Failure = "unauthorized" | "notConfigured" | "noTenant" | "forbidden" | "conflict" | "invalid" | "unavailable" | "network";
type Payload = { tenant: Tenant; profile: BusinessProfileInput | null };
type Result = { ok: true; payload: Payload } | { ok: false; failure: Failure };
type Load = { status: "loading" } | { status: "error"; failure: Failure } | { status: "ready"; tenant: Tenant };
type Draft = { tradeName: string; country: string; locale: string } & Record<AssessmentQuestion, string>;
type Feedback = { kind: "saved" } | { kind: "incomplete" } | { kind: "error"; failure: Failure };

const FAILURE_BY_CODE: Record<string, Failure> = {
  unauthorized: "unauthorized",
  not_configured: "notConfigured",
  no_tenant: "noTenant",
  forbidden: "forbidden",
  conflict: "conflict",
  invalid_profile: "invalid",
  invalid_request: "invalid",
};

// Sign-in still lives in the Supabase spike (ADR-0008); this link moves with it.
const SIGN_IN_PATH = "/spike/login";
const PROFILE_FIELDS = ["tradeName", "country", "locale", ...ASSESSMENT_QUESTIONS] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureOf(status: number, code: unknown): Failure {
  if (typeof code === "string" && Object.hasOwn(FAILURE_BY_CODE, code)) return FAILURE_BY_CODE[code] ?? "unavailable";
  return status === 401 ? "unauthorized" : "unavailable";
}

// The response carries more than the form edits (ids, dates): keep only the editable fields and reuse the contract parser.
function readPayload(body: unknown): Payload | null {
  if (!isRecord(body) || !isRecord(body.tenant)) return null;
  const { id, name, role } = body.tenant;
  if (!isUuid(id) || typeof name !== "string" || typeof role !== "string" || !(TENANT_ROLES as readonly string[]).includes(role)) return null;
  const tenant: Tenant = { id, name, role: role as TenantRole };
  if (body.profile === null) return { tenant, profile: null };
  if (!isRecord(body.profile)) return null;

  const source = body.profile;
  const profile = parseBusinessProfileInput(Object.fromEntries(PROFILE_FIELDS.map((field) => [field, source[field]])));
  return profile ? { tenant, profile } : null;
}

async function requestProfile(write?: BusinessProfileInput): Promise<Result> {
  try {
    const response = await fetch(
      "/api/profile",
      write
        ? { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(write) }
        : { cache: "no-store" },
    );
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, failure: failureOf(response.status, isRecord(body) ? body.error : undefined) };
    const payload = readPayload(body);
    return payload ? { ok: true, payload } : { ok: false, failure: "unavailable" };
  } catch {
    return { ok: false, failure: "network" };
  }
}

// A new profile starts from the company name; the language falls back to the interface language on save.
function draftOf(payload: Payload): Draft {
  if (payload.profile) return { ...payload.profile };
  return { tradeName: payload.tenant.name, country: "", locale: "", sector: "", teamSize: "", channel: "", crm: "", problem: "", goal: "" };
}

function countryName(code: string, tag: string): string | null {
  if (!/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames([tag], { type: "region" }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}


export function CompanyProfile() {
  const { m, locale, tag } = useI18n();
  const copy = m.companyProfile;
  const answerLabels = m.nex.assessment.labels;
  const answerOptions = m.nex.assessment.options;
  const ids = useId();

  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const applyResult = useCallback((result: Result) => {
    if (!result.ok) {
      setLoad({ status: "error", failure: result.failure });
      return;
    }
    setLoad({ status: "ready", tenant: result.payload.tenant });
    setDraft(draftOf(result.payload));
    setHasProfile(result.payload.profile !== null);
  }, []);

  useEffect(() => {
    let active = true;
    void requestProfile().then((result) => {
      if (active) applyResult(result);
    });
    return () => {
      active = false;
    };
  }, [applyResult]);

  function retry() {
    setLoad({ status: "loading" });
    setFeedback(null);
    void requestProfile().then(applyResult);
  }

  function update(field: keyof Draft, value: string) {
    setFeedback(null);
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (load.status !== "ready" || !draft || saving) return;

    const input = parseBusinessProfileInput({ ...draft, locale: draft.locale || locale });
    if (!input) {
      setFeedback({ kind: "incomplete" });
      return;
    }

    setSaving(true);
    setFeedback(null);
    const result = await requestProfile(input);
    setSaving(false);
    if (!result.ok) {
      setFeedback({ kind: "error", failure: result.failure });
      return;
    }
    setLoad({ status: "ready", tenant: result.payload.tenant });
    setDraft(draftOf(result.payload));
    setHasProfile(true);
    setFeedback({ kind: "saved" });
  }

  const readOnly = load.status === "ready" && load.tenant.role !== "owner";
  const name = draft ? countryName(draft.country, tag) : null;

  return (
    <section className="card animate-fade-up p-5 sm:p-6" aria-labelledby={`${ids}-title`} aria-busy={load.status === "loading"}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          {copy.title}
        </h2>
        {/* The rest of the Settings page is demo content: say plainly that this section is not. */}
        <Badge tone="primary">{copy.realDataTag}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{copy.description}</p>
      <p className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm text-ink-soft">{copy.pilotNotice}</p>

      {load.status === "loading" && (
        <p role="status" className="mt-5 text-sm text-ink-muted">
          {m.common.loading}
        </p>
      )}

      {load.status === "error" && (
        <div className="mt-5 space-y-3">
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger-soft">
            {copy.errors[load.failure]}
          </p>
          <div className="flex flex-wrap gap-3">
            {load.failure === "unauthorized" && (
              <a
                href={SIGN_IN_PATH}
                className={buttonClass("primary", "md", "min-h-11 px-5")}
              >
                {copy.signIn}
              </a>
            )}
            <button
              type="button"
              onClick={retry}
              className={buttonClass("secondary", "md", "min-h-11 px-5")}
            >
              {copy.retry}
            </button>
          </div>
        </div>
      )}

      {load.status === "ready" && draft && (
        <form onSubmit={onSubmit} noValidate className="mt-5 space-y-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">{copy.company}</dt>
              <dd className="font-medium text-ink">{load.tenant.name}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{copy.role}</dt>
              <dd className="font-medium text-ink">{load.tenant.role === "owner" || load.tenant.role === "member" ? copy.roles[load.tenant.role] : ROLE_LABEL[load.tenant.role]}</dd>
            </div>
          </dl>

          {readOnly && <p className="text-sm text-ink-soft">{copy.readOnly}</p>}
          {!hasProfile && !readOnly && <p className="text-sm text-ink-soft">{copy.noProfileYet}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${ids}-tradeName`} className={LABEL}>
                {copy.fields.tradeName}
              </label>
              <input
                id={`${ids}-tradeName`}
                type="text"
                maxLength={120}
                value={draft.tradeName}
                disabled={readOnly || saving}
                onChange={(event) => update("tradeName", event.target.value)}
                className={FIELD_LG}
              />
            </div>

            <div>
              <label htmlFor={`${ids}-country`} className={LABEL}>
                {copy.fields.country}
              </label>
              <input
                id={`${ids}-country`}
                type="text"
                maxLength={2}
                autoCapitalize="characters"
                spellCheck={false}
                value={draft.country}
                disabled={readOnly || saving}
                aria-describedby={`${ids}-country-hint`}
                onChange={(event) => update("country", event.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())}
                className={FIELD_LG}
              />
              <p id={`${ids}-country-hint`} className="mt-1 text-xs text-ink-muted">
                {name ?? copy.fields.countryHint}
              </p>
            </div>

            <div>
              <label htmlFor={`${ids}-locale`} className={LABEL}>
                {copy.fields.language}
              </label>
              <select
                id={`${ids}-locale`}
                value={draft.locale || locale}
                disabled={readOnly || saving}
                onChange={(event) => update("locale", event.target.value)}
                className={FIELD_LG}
              >
                {LOCALES.map((code) => (
                  <option key={code} value={code} className="bg-surface text-ink">
                    {LOCALE_LABELS[code]}
                  </option>
                ))}
              </select>
            </div>

            {ASSESSMENT_QUESTIONS.map((question) => (
              <div key={question}>
                <label htmlFor={`${ids}-${question}`} className={LABEL}>
                  {answerLabels[question]}
                </label>
                <select
                  id={`${ids}-${question}`}
                  value={draft[question]}
                  disabled={readOnly || saving}
                  onChange={(event) => update(question, event.target.value)}
                  className={FIELD_LG}
                >
                  <option value="" className="bg-surface text-ink">
                    {copy.choose}
                  </option>
                  {ASSESSMENT_OPTIONS[question].map((option) => (
                    <option key={option} value={option} className="bg-surface text-ink">
                      {(answerOptions[question] as Record<string, string>)[option]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {feedback?.kind === "saved" && (
            <p role="status" className="rounded-xl border border-line bg-surface p-3 text-sm text-primary-soft">
              {copy.saved}
            </p>
          )}
          {feedback?.kind === "incomplete" && (
            <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft">
              {copy.incomplete}
            </p>
          )}
          {feedback?.kind === "error" && (
            <div className="space-y-3">
              <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft">
                {copy.errors[feedback.failure]}
              </p>
              {feedback.failure === "unauthorized" && (
                <a
                  href={SIGN_IN_PATH}
                  className={buttonClass("secondary", "md", "min-h-11 px-5")}
                >
                  {copy.signIn}
                </a>
              )}
            </div>
          )}

          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className={buttonClass("primary", "lg", "min-h-12")}
            >
              {saving ? copy.saving : copy.save}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
