import { describe, expect, it } from "vitest";
import { LOCALES } from "./i18n/config";
import { loadMessages } from "./i18n/messages";
import { detectIntent, simulateNexReply } from "./nex";

describe("NEX simulation", () => {
  it.each(LOCALES)("%s: every suggestion, quick action and example gets a specific answer", async (locale) => {
    const { nex } = await loadMessages(locale);
    const prompts = [...nex.suggestionItems, ...nex.quickActionItems, ...nex.exampleItems];
    const unmatched = prompts.filter((prompt) => detectIntent(prompt, nex.keywords) === "fallback");
    expect(unmatched).toEqual([]);
  });

  it("routes an email request to the email intent even when it mentions a follow-up", async () => {
    const { nex } = await loadMessages("es");
    expect(detectIntent("Redacta un correo de seguimiento", nex.keywords)).toBe("email");
  });

  it("falls back for unrelated prompts", async () => {
    const { nex } = await loadMessages("es");
    expect(simulateNexReply("hola", nex)).toBe(nex.responses.fallback);
  });
});
