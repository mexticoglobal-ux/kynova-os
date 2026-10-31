// Tenancy and Business Profile v1 contracts (ADR-0006). The database CHECKs mirror these values;
// lib/contracts/tenancy.test.ts keeps both in sync. Database rows are validated here, never trusted.

import { ASSESSMENT_OPTIONS, ASSESSMENT_QUESTIONS, type AssessmentAnswers } from "./assessment";

export const TENANT_ROLES = ["owner", "member"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** Version of the closed questionnaire the profile answers belong to. */
export const QUESTIONNAIRE_VERSION = 1;

export const TRADE_NAME_MAX_LENGTH = 120;

export type BusinessProfileInput = AssessmentAnswers & {
  tradeName: string;
  country: string;
  locale: string;
};

export type BusinessProfile = BusinessProfileInput & {
  tenantId: string;
  questionnaireVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type TenantMembership = {
  tenantId: string;
  name: string;
  role: TenantRole;
};

// API column names for the answers, in the order of ASSESSMENT_QUESTIONS.
export const PROFILE_ANSWER_COLUMNS = {
  sector: "sector",
  teamSize: "team_size",
  channel: "channel",
  crm: "crm",
  problem: "problem",
  goal: "goal",
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const LOCALE_PATTERN = /^[a-z]{2}$/;
const INPUT_KEYS = new Set<string>(["tradeName", "country", "locale", ...ASSESSMENT_QUESTIONS]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function parseAnswers(source: UnknownRecord, keyOf: (question: keyof AssessmentAnswers) => string): AssessmentAnswers | null {
  const answers: Partial<Record<keyof AssessmentAnswers, string>> = {};
  for (const question of ASSESSMENT_QUESTIONS) {
    const value = source[keyOf(question)];
    if (typeof value !== "string" || !(ASSESSMENT_OPTIONS[question] as readonly string[]).includes(value)) return null;
    answers[question] = value;
  }
  return answers as AssessmentAnswers;
}

function asciiPair(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z]{2}$/.test(text) ? text : null;
}

function parseTradeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= TRADE_NAME_MAX_LENGTH ? name : null;
}

/** Validates a client-supplied profile. Strict: unknown keys, wrong types and out-of-domain values give null. */
export function parseBusinessProfileInput(value: unknown): BusinessProfileInput | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !INPUT_KEYS.has(key))) return null;

  const tradeName = parseTradeName(value.tradeName);
  // ASCII letters are required before changing case: 'ß'.toUpperCase() is 'SS', which would pass as a country.
  const country = asciiPair(value.country)?.toUpperCase() ?? "";
  const locale = asciiPair(value.locale)?.toLowerCase() ?? "";
  const answers = parseAnswers(value, (question) => question);
  if (!tradeName || !answers || !COUNTRY_PATTERN.test(country) || !LOCALE_PATTERN.test(locale)) return null;

  return { tradeName, country, locale, ...answers };
}

/** Maps a `business_profiles` row (snake_case) to the contract, or null when the row is not valid. */
export function parseBusinessProfileRow(row: unknown): BusinessProfile | null {
  if (!isRecord(row)) return null;
  const answers = parseAnswers(row, (question) => PROFILE_ANSWER_COLUMNS[question]);
  const tradeName = parseTradeName(row.trade_name);
  if (
    !answers ||
    !tradeName ||
    !isUuid(row.tenant_id) ||
    typeof row.country !== "string" ||
    !COUNTRY_PATTERN.test(row.country) ||
    typeof row.locale !== "string" ||
    !LOCALE_PATTERN.test(row.locale) ||
    typeof row.questionnaire_version !== "number" ||
    !Number.isInteger(row.questionnaire_version) ||
    row.questionnaire_version < 1 ||
    !isTimestamp(row.created_at) ||
    !isTimestamp(row.updated_at)
  ) {
    return null;
  }

  return {
    tenantId: row.tenant_id,
    tradeName,
    country: row.country,
    locale: row.locale,
    questionnaireVersion: row.questionnaire_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...answers,
  };
}

/** Maps a `memberships` row embedding its tenant name (`tenants(name)`) to the contract. */
export function parseMembershipRow(row: unknown): TenantMembership | null {
  if (!isRecord(row) || !isUuid(row.tenant_id)) return null;
  if (typeof row.role !== "string" || !(TENANT_ROLES as readonly string[]).includes(row.role)) return null;

  // PostgREST embeds a to-one relation as an object; tolerate a one-element array.
  const embedded = Array.isArray(row.tenants) && row.tenants.length === 1 ? row.tenants[0] : row.tenants;
  if (!isRecord(embedded) || typeof embedded.name !== "string" || embedded.name.length === 0) return null;

  return { tenantId: row.tenant_id, name: embedded.name, role: row.role as TenantRole };
}
