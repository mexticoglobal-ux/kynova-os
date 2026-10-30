import { describe, expect, it } from "vitest";
import { hasSameOrigin, isWithinBodyLimit, noStore } from "./supabase-spike-http";

describe("spike response cache policy", () => {
  it("marks personal test responses as private and non-cacheable", () => {
    const response = noStore(new Response("ok"));
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  it("accepts only same-origin mutations", () => {
    expect(hasSameOrigin(new Request("https://kynova.test/api/spike", { method: "POST", headers: { Origin: "https://kynova.test" } }))).toBe(true);
    expect(hasSameOrigin(new Request("https://kynova.test/api/spike", { method: "POST", headers: { Origin: "https://attacker.test" } }))).toBe(false);
    expect(hasSameOrigin(new Request("https://kynova.test/api/spike", { method: "POST" }))).toBe(false);
  });

  it("limits form bodies before parsing them", () => {
    expect(isWithinBodyLimit(new Request("https://kynova.test/api/spike", { headers: { "content-length": "4096" } }))).toBe(true);
    expect(isWithinBodyLimit(new Request("https://kynova.test/api/spike", { headers: { "content-length": "4097" } }))).toBe(false);
    expect(isWithinBodyLimit(new Request("https://kynova.test/api/spike", { headers: { "content-length": "invalid" } }))).toBe(false);
    expect(isWithinBodyLimit(new Request("https://kynova.test/api/spike"))).toBe(false);
  });
});
