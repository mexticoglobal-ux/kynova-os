import { describe, expect, it } from "vitest";
import { LOCALES } from "./config";
import { loadMessages } from "./messages";
import { es } from "./messages/es";

type Issue = string;

function compareShape(reference: unknown, candidate: unknown, path: string, issues: Issue[]) {
  if (typeof reference === "string") {
    if (typeof candidate !== "string") issues.push(`${path}: expected string`);
    else if (candidate.trim() === "") issues.push(`${path}: empty string`);
    return;
  }
  if (Array.isArray(reference)) {
    if (!Array.isArray(candidate)) return void issues.push(`${path}: expected array`);
    // Keyword vocabularies legitimately differ in size per language; they only need to be non-empty strings.
    if (path.includes(".nex.keywords.")) {
      if (candidate.length === 0) issues.push(`${path}: empty keyword list`);
      candidate.forEach((word, index) => compareShape("", word, `${path}[${index}]`, issues));
      return;
    }
    if (candidate.length !== reference.length) issues.push(`${path}: length ${candidate.length} !== ${reference.length}`);
    reference.forEach((item, index) => compareShape(item, candidate[index], `${path}[${index}]`, issues));
    return;
  }
  if (typeof reference === "object" && reference !== null) {
    if (typeof candidate !== "object" || candidate === null) return void issues.push(`${path}: expected object`);
    const referenceKeys = Object.keys(reference).sort();
    const candidateKeys = Object.keys(candidate).sort();
    if (referenceKeys.join() !== candidateKeys.join()) issues.push(`${path}: keys differ`);
    for (const key of referenceKeys) {
      compareShape((reference as Record<string, unknown>)[key], (candidate as Record<string, unknown>)[key], `${path}.${key}`, issues);
    }
  }
}

describe("i18n dictionaries", () => {
  it.each(LOCALES)("%s has the same shape as Spanish and no empty strings", async (locale) => {
    const messages = await loadMessages(locale);
    const issues: Issue[] = [];
    compareShape(es, messages, locale, issues);
    expect(issues).toEqual([]);
  });

  it.each(LOCALES)("%s month labels are unique", async (locale) => {
    const { dashboard } = await loadMessages(locale);
    expect(new Set(dashboard.months).size).toBe(dashboard.months.length);
  });
});
