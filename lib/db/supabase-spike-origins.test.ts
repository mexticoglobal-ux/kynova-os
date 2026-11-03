import { describe, expect, it } from "vitest";
import { SPIKE_ALLOWED_ORIGINS, SPIKE_CALLBACK_PATH, spikeCallbackUrl } from "./supabase-spike-config";

describe("spikeCallbackUrl", () => {
  it("returns the fixed callback of every allowed origin, ignoring path, query and fragment", () => {
    for (const origin of SPIKE_ALLOWED_ORIGINS) {
      const expected = `${origin}${SPIKE_CALLBACK_PATH}`;
      expect(spikeCallbackUrl(`${origin}/api/spike/auth/request`)).toBe(expected);
      expect(spikeCallbackUrl(`${origin}/anything?redirectTo=https://evil.test#frag`)).toBe(expected);
    }
  });

  it("only allows exact origins: scheme, host and port all have to match", () => {
    for (const url of [
      "https://attacker.test/api/spike/auth/request",
      "http://localhost:3001/",
      "https://localhost:3000/",
      "http://localhost/",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:8787/",
      "http://kynova-os-preview.novamarketingstudiocr.workers.dev/",
      "https://kynova-os-preview.novamarketingstudiocr.workers.dev.attacker.test/",
      "https://attacker.test/?https://kynova-os-preview.novamarketingstudiocr.workers.dev",
    ]) {
      expect(spikeCallbackUrl(url)).toBeNull();
    }
  });

  it("does not let credentials or a look-alike host smuggle an allowed origin", () => {
    // The origin of this URL is evil.test: what precedes the @ is user info.
    expect(spikeCallbackUrl("https://kynova-os-preview.novamarketingstudiocr.workers.dev@evil.test/")).toBeNull();
    expect(spikeCallbackUrl("http://localhost:3000@evil.test/")).toBeNull();
  });

  it("fails closed on values that are not URLs", () => {
    for (const value of ["", "not a url", "//localhost:3000", "localhost:3000/api"]) expect(spikeCallbackUrl(value)).toBeNull();
  });

  it("lists only local development and the Preview Worker, never production", () => {
    expect(SPIKE_ALLOWED_ORIGINS.every((origin) => origin.startsWith("http://localhost") || origin.includes("kynova-os-preview"))).toBe(true);
    expect(SPIKE_CALLBACK_PATH).toBe("/api/spike/auth/callback");
  });
});
