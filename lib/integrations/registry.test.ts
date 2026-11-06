import { describe, expect, it } from "vitest";
import { getChannelAdapter, integrationStates, isKnownProvider } from "./registry";

describe("integration registry", () => {
  it("declares every channel and payment provider and connects none of them yet", () => {
    const states = integrationStates();
    expect(states).toHaveLength(11);
    expect(states.filter((state) => state.connected)).toEqual([]);
    expect(states.find((state) => state.provider === "webChat")?.status).toBe("demo");
    expect(states.filter((state) => state.status === "planned")).toHaveLength(10);
    expect(getChannelAdapter("whatsapp")).toBeUndefined();
  });

  it("knows only the declared providers", () => {
    for (const provider of ["webChat", "whatsapp", "facebook", "instagram", "email", "form", "stripe", "paypal", "makapay", "makawallet", "sinpe"]) expect(isKnownProvider(provider)).toBe(true);
    expect(isKnownProvider("telegram")).toBe(false);
  });
});
