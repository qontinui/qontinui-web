/**
 * sessionQuery — the `/sessions` search box accepts a name, an id, or a pasted
 * commit trailer line. Plan
 * `2026-10-19-session-lookup-by-name-shows-claude-account-in-web` Phase 3.
 */

import { describe, expect, it } from "vitest";

import { normalizeSessionQuery } from "./sessionQuery";

const SID = "86e2b721-8270-49fe-bb15-6c8b33b000c8";

describe("normalizeSessionQuery", () => {
  it("passes a plain name through, trimmed", () => {
    expect(normalizeSessionQuery("  spaceship-latency  ")).toEqual({
      query: "spaceship-latency",
      trailer: null,
    });
  });

  it("passes a bare session id through", () => {
    expect(normalizeSessionQuery(SID)).toEqual({ query: SID, trailer: null });
  });

  it("strips a pasted Session-Id: prefix", () => {
    expect(normalizeSessionQuery(`Session-Id: ${SID}`)).toEqual({
      query: SID,
      trailer: "Session-Id",
    });
  });

  it("strips a pasted Session-Name: prefix, keeping the whole name", () => {
    expect(
      normalizeSessionQuery("    Session-Name: spaceship latency follow-up  ")
    ).toEqual({
      query: "spaceship latency follow-up",
      trailer: "Session-Name",
    });
  });

  it("is case-insensitive on the trailer key, like git", () => {
    expect(normalizeSessionQuery(`session-id:${SID}`).query).toBe(SID);
    expect(normalizeSessionQuery("SESSION-NAME:\tfoo").query).toBe("foo");
  });

  it("prefers the Session-Id line when a whole trailer block is pasted", () => {
    const block = [
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "Session-Name: spaceship-latency",
      `Session-Id: ${SID}`,
    ].join("\n");
    expect(normalizeSessionQuery(block)).toEqual({
      query: SID,
      trailer: "Session-Id",
    });
  });

  it("splits trailers a single-line input glued together (newlines stripped)", () => {
    // An <input type=text> drops the newline from a multi-line paste.
    expect(
      normalizeSessionQuery(`Session-Id: ${SID}Session-Name: spaceship-latency`)
    ).toEqual({ query: SID, trailer: "Session-Id" });
    expect(
      normalizeSessionQuery("Session-Name: spaceship-latencySession-Id: ")
    ).toEqual({ query: "spaceship-latency", trailer: "Session-Name" });
  });

  it("cuts a Session-Id value to its uuid so a glued suffix cannot leak in", () => {
    expect(
      normalizeSessionQuery(`Session-Id: ${SID}Co-Authored-By: x`).query
    ).toBe(SID);
  });

  it("cuts a glued Session-Name value at the other fleet trailer keys", () => {
    for (const next of [
      "Claude-Session: https://claude.ai/code/session_01ABC",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "Plan: 2026-10-19-session-lookup-by-name-shows-claude-account-in-web phases: 3",
      `Session-Id: ${SID}`,
    ]) {
      expect(
        normalizeSessionQuery(`Session-Name: spaceship-latency${next}`).query
      ).toBe(next.startsWith("Session-Id") ? SID : "spaceship-latency");
    }
  });

  it("cuts a non-uuid Session-Id value at a glued fleet trailer too", () => {
    expect(
      normalizeSessionQuery("Session-Id: legacy-idClaude-Session: x").query
    ).toBe("legacy-id");
  });

  it("does NOT cut a name at a generic `word:` — plan-derived names contain them", () => {
    expect(
      normalizeSessionQuery("Session-Name: feat: ship the console").query
    ).toBe("feat: ship the console");
    expect(
      normalizeSessionQuery("Session-Name: fix: the plan: phase 2").query
    ).toBe("fix: the plan: phase 2");
  });

  it("a prefix with no value yet sends NO query, not the literal word", () => {
    expect(normalizeSessionQuery("Session-Id:")).toEqual({
      query: "",
      trailer: "Session-Id",
    });
    expect(normalizeSessionQuery("Session-Name:   ")).toEqual({
      query: "",
      trailer: "Session-Name",
    });
  });

  it("an empty box is an empty query", () => {
    expect(normalizeSessionQuery("   ")).toEqual({ query: "", trailer: null });
  });
});
