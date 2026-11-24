import { describe, expect, it } from "vitest";
import {
  FAILURE_CODES, FAILURE_MESSAGES, YOUTUBE_READ_SCOPE, buildAuthorizeUrl, callbackUriFor, parseChannelsResponse, parseConnectionStatus, parseTokenResponse,
} from "./youtube-connection";

describe("the authorization address", () => {
  const url = new URL(buildAuthorizeUrl({ clientId: "123-abc.apps.googleusercontent.com", redirectUri: "https://app.example.test/api/v1/connections/youtube/callback", state: "s".repeat(43) }));

  it("asks for the single read-only permission, offline access and a state, and never carries a secret", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_READ_SCOPE);
    expect(url.searchParams.get("scope")).not.toMatch(/upload|force-ssl|youtubepartner|\s|auth\/youtube$/); // exactly youtube.readonly: no upload, no management, no second scope
    expect(YOUTUBE_READ_SCOPE).toBe("https://www.googleapis.com/auth/youtube.readonly");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("s".repeat(43));
    expect(url.searchParams.get("client_id")).toBe("123-abc.apps.googleusercontent.com");
    expect(url.toString()).not.toMatch(/client_secret|code_verifier|token/i);
    expect([...url.searchParams.keys()].sort()).toEqual(["access_type", "client_id", "prompt", "redirect_uri", "response_type", "scope", "state"]);
  });
});

describe("the callback address", () => {
  it("accepts https and localhost development, and refuses anything else", () => {
    expect(callbackUriFor("https://app.example.test")).toBe("https://app.example.test/api/v1/connections/youtube/callback");
    expect(callbackUriFor("http://localhost:3000")).toBe("http://localhost:3000/api/v1/connections/youtube/callback");
    for (const bad of ["http://app.example.test", "ftp://app.example.test", "https://user:pass@app.example.test", "not a url", "javascript:alert(1)"]) expect(callbackUriFor(bad), bad).toBeNull();
  });
});

describe("what Google answers", () => {
  it("reads a token answer, with or without a refresh token, and an invalid grant", () => {
    expect(parseTokenResponse({ access_token: "ya29.a0AbCdEfGhIj", refresh_token: "1//0gRefreshTokenValue", scope: YOUTUBE_READ_SCOPE, token_type: "Bearer" })).toEqual({ ok: true, accessToken: "ya29.a0AbCdEfGhIj", refreshToken: "1//0gRefreshTokenValue", scopes: [YOUTUBE_READ_SCOPE] });
    expect(parseTokenResponse({ access_token: "ya29.a0AbCdEfGhIj", scope: YOUTUBE_READ_SCOPE })).toMatchObject({ ok: true, refreshToken: null });
    expect(parseTokenResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." })).toEqual({ ok: false, reason: "invalid_grant" });
    for (const bad of [null, "x", 5, {}, { access_token: "short" }, { access_token: 7 }, { error: "invalid_client" }]) expect(parseTokenResponse(bad), String(bad)).toMatchObject({ ok: false });
  });

  it("reads the channel of the authorized account, and nothing when there is none or the shape is wrong", () => {
    expect(parseChannelsResponse({ items: [{ id: "UCabcDEF123_-xyz", snippet: { title: "  Mi canal  " } }] })).toEqual({ id: "UCabcDEF123_-xyz", title: "Mi canal" });
    for (const bad of [null, {}, { items: [] }, { items: [{ id: "bad id!", snippet: { title: "x" } }] }, { items: [{ id: "UCok", snippet: { title: "  " } }] }, { items: [{ snippet: { title: "x" } }] }, { items: "x" }]) expect(parseChannelsResponse(bad)).toBeNull();
  });
});

describe("the status the screen receives", () => {
  const setup = { configured: true, missing: [] as string[] };
  it("is connected only when the database says so with a channel, and reads anything else as disconnected", () => {
    const row = { state: "connected", accountId: "UCabc", accountLabel: "Mi canal", connectedAt: "2026-11-28T10:00:00Z", lastVerifiedAt: "2026-11-28T10:00:00Z", lastErrorCode: null };
    expect(parseConnectionStatus(row, setup)).toMatchObject({ state: "connected", channel: { id: "UCabc", title: "Mi canal" }, configured: true });
    expect(parseConnectionStatus({ ...row, accountId: null }, setup).state).toBe("disconnected"); // "connected" without a channel is not a connection
    expect(parseConnectionStatus({ ...row, state: "simulated" }, setup).state).toBe("disconnected");
    expect(parseConnectionStatus(null, setup).state).toBe("disconnected");
    expect(parseConnectionStatus({ state: "disconnected" }, setup).channel).toBeNull();
    expect(parseConnectionStatus({ ...row, state: "expired", lastErrorCode: "invalid_grant" }, setup)).toMatchObject({ state: "expired", lastErrorCode: "invalid_grant" });
    expect(parseConnectionStatus({ ...row, state: "error", lastErrorCode: "x y" }, setup)).toMatchObject({ state: "error", lastErrorCode: null });
  });

  it("carries only names, never a credential, and says what is missing", () => {
    const status = parseConnectionStatus({ state: "connected", accountId: "UCabc", accountLabel: "c", connectedAt: "2026-11-28T10:00:00Z", tokenCt: "v1.AAAAAAAAAA.BBBBBBBBBBBB", refresh_token: "x" }, { configured: false, missing: ["GOOGLE_CLIENT_ID"] });
    expect(JSON.stringify(status)).not.toMatch(/v1\.|refresh|token/i);
    expect(status).toMatchObject({ configured: false, missing: ["GOOGLE_CLIENT_ID"] });
  });

  it("has a sentence for every failure code", () => {
    for (const code of FAILURE_CODES) expect(FAILURE_MESSAGES[code].length, code).toBeGreaterThan(10);
  });
});
