import { describe, expect, it } from "vitest";
import { parseSpikeEmail, parseSpikeOtp } from "./supabase-spike";

describe("Supabase spike input contracts", () => {
  it("normalizes and validates email addresses", () => {
    expect(parseSpikeEmail("  TEST+tenant@example.com ")).toBe("test+tenant@example.com");
    expect(parseSpikeEmail("invalid-email")).toBeNull();
    expect(parseSpikeEmail(new File(["x"], "email.txt"))).toBeNull();
  });

  it("accepts OTP codes from six to ten digits", () => {
    expect(parseSpikeOtp("012345")).toBe("012345");
    expect(parseSpikeOtp("01234567")).toBe("01234567");
    expect(parseSpikeOtp("12345")).toBeNull();
    expect(parseSpikeOtp("12345678901")).toBeNull();
    expect(parseSpikeOtp("12345x")).toBeNull();
    expect(parseSpikeOtp(null)).toBeNull();
  });
});
