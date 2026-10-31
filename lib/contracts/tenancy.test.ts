import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSESSMENT_OPTIONS, ASSESSMENT_QUESTIONS } from "./assessment";
import {
  PROFILE_ANSWER_COLUMNS,
  TENANT_ROLES,
  TRADE_NAME_MAX_LENGTH,
  parseBusinessProfileInput,
  parseBusinessProfileRow,
  parseMembershipRow,
} from "./tenancy";

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1";

const input = {
  tradeName: "  Empresa de prueba  ",
  country: "cr",
  locale: "ES",
  sector: "software",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
};

const row = {
  tenant_id: TENANT_ID,
  trade_name: "Empresa de prueba",
  country: "CR",
  locale: "es",
  sector: "software",
  team_size: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
  questionnaire_version: 1,
  created_at: "2026-10-31T10:00:00+00:00",
  updated_at: "2026-10-31T10:05:00.123456+00:00",
};

describe("parseBusinessProfileInput", () => {
  it("normalizes a valid profile", () => {
    expect(parseBusinessProfileInput(input)).toEqual({
      tradeName: "Empresa de prueba",
      country: "CR",
      locale: "es",
      sector: "software",
      teamSize: "small",
      channel: "web",
      crm: "basicTool",
      problem: "leads",
      goal: "moreSales",
    });
  });

  it("rejects anything that is not a plain object", () => {
    for (const value of [null, undefined, "x", 1, [], [input]]) expect(parseBusinessProfileInput(value)).toBeNull();
  });

  it("rejects unknown keys, so a client cannot smuggle tenant_id, authorship or role", () => {
    for (const extra of ["tenantId", "tenant_id", "createdBy", "updatedBy", "role", "id"]) {
      expect(parseBusinessProfileInput({ ...input, [extra]: "x" })).toBeNull();
    }
  });

  it("rejects missing, out-of-domain and non-string answers", () => {
    for (const question of ASSESSMENT_QUESTIONS) {
      const { [question]: _omitted, ...rest } = input;
      expect(parseBusinessProfileInput(rest)).toBeNull();
      expect(parseBusinessProfileInput({ ...input, [question]: "notAnOption" })).toBeNull();
      expect(parseBusinessProfileInput({ ...input, [question]: 1 })).toBeNull();
    }
  });

  it("rejects invalid trade names, countries and locales", () => {
    expect(parseBusinessProfileInput({ ...input, tradeName: "   " })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, tradeName: "x".repeat(TRADE_NAME_MAX_LENGTH + 1) })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, tradeName: "x".repeat(TRADE_NAME_MAX_LENGTH) })).not.toBeNull();
    expect(parseBusinessProfileInput({ ...input, country: "CRI" })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, country: "1A" })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, locale: "es-CR" })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, locale: 5 })).toBeNull();
  });

  it("requires ASCII letters before normalizing case, so 'ß' cannot become the country 'SS'", () => {
    expect(parseBusinessProfileInput({ ...input, country: "ß" })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, country: "ǅa" })).toBeNull();
    expect(parseBusinessProfileInput({ ...input, locale: "éS" })).toBeNull();
  });
});

describe("parseBusinessProfileRow", () => {
  it("maps a valid row to the contract", () => {
    expect(parseBusinessProfileRow(row)).toEqual({
      tenantId: TENANT_ID,
      tradeName: "Empresa de prueba",
      country: "CR",
      locale: "es",
      sector: "software",
      teamSize: "small",
      channel: "web",
      crm: "basicTool",
      problem: "leads",
      goal: "moreSales",
      questionnaireVersion: 1,
      createdAt: "2026-10-31T10:00:00+00:00",
      updatedAt: "2026-10-31T10:05:00.123456+00:00",
    });
  });

  it("does not trust the database: any malformed field gives null", () => {
    expect(parseBusinessProfileRow(null)).toBeNull();
    expect(parseBusinessProfileRow({ ...row, tenant_id: "not-a-uuid" })).toBeNull();
    expect(parseBusinessProfileRow({ ...row, sector: "other-sector" })).toBeNull();
    expect(parseBusinessProfileRow({ ...row, country: "cr" })).toBeNull();
    expect(parseBusinessProfileRow({ ...row, questionnaire_version: 0 })).toBeNull();
    expect(parseBusinessProfileRow({ ...row, questionnaire_version: "1" })).toBeNull();
    expect(parseBusinessProfileRow({ ...row, updated_at: "yesterday" })).toBeNull();
  });
});

describe("parseMembershipRow", () => {
  it("reads the embedded tenant name as an object or a one-element array", () => {
    const expected = { tenantId: TENANT_ID, name: "Empresa A", role: "owner" };
    expect(parseMembershipRow({ tenant_id: TENANT_ID, role: "owner", tenants: { name: "Empresa A" } })).toEqual(expected);
    expect(parseMembershipRow({ tenant_id: TENANT_ID, role: "owner", tenants: [{ name: "Empresa A" }] })).toEqual(expected);
  });

  it("rejects unknown roles and incomplete rows", () => {
    expect(parseMembershipRow({ tenant_id: TENANT_ID, role: "admin", tenants: { name: "A" } })).toBeNull();
    expect(parseMembershipRow({ tenant_id: TENANT_ID, role: "member", tenants: null })).toBeNull();
    expect(parseMembershipRow({ tenant_id: TENANT_ID, role: "member", tenants: [] })).toBeNull();
    expect(parseMembershipRow({ tenant_id: "x", role: "member", tenants: { name: "A" } })).toBeNull();
  });
});

describe("database migration stays in sync with the contract", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8"))
    .join("\n");

  const checkValues = (column: string) => {
    const match = sql.match(new RegExp(`\\b${column}\\s+text\\s+not\\s+null\\s+check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, "i"));
    return match?.[1]?.split(",").map((value) => value.trim().replace(/^'|'$/g, "")).sort();
  };

  it.each(ASSESSMENT_QUESTIONS)("the CHECK on the %s column lists exactly the contract options", (question) => {
    expect(checkValues(PROFILE_ANSWER_COLUMNS[question])).toEqual([...ASSESSMENT_OPTIONS[question]].sort());
  });

  it("the role CHECK lists exactly the contract roles", () => {
    expect(checkValues("role")).toEqual([...TENANT_ROLES].sort());
  });

  it("enables RLS on every table the migration creates and never grants DELETE on business profiles", () => {
    const tables = [...sql.matchAll(/create table public\.(\w+)/gi)].map((match) => match[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    expect(sql).not.toMatch(/grant[^;]*\bdelete\b[^;]*business_profiles/i);
  });
});
