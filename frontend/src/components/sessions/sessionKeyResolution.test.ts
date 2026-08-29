/**
 * `/sessions/[key]`'s resolver — D4 and trap 8, asserted rather than trusted.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md`. Pure module, so nothing
 * here mocks a network: the point is that the CONCLUSIONS are testable, and
 * the two that matter are "render every match" and "a read that did not land
 * is not an absence".
 */

import { describe, expect, it } from "vitest";

import { AgentSessionsApiError } from "@/services/agent-sessions-api";
import { SessionsApiError } from "./api";
import {
  RESERVED_SESSION_SEGMENTS,
  classifyAgentError,
  classifyLifecycleError,
  deriveKeyVerdict,
  isReservedSessionSegment,
  type AgentHalf,
  type LifecycleHalf,
} from "./sessionKeyResolution";
import type { SessionCard } from "@/services/agent-sessions-api";
import type { SessionRow } from "./types";

function card(id: string, name: string): SessionCard {
  return {
    id,
    name,
    label: name,
    derived_name: name,
    user_id: null,
    device_id: null,
    first_seen: null,
    last_seen: null,
    closed_at: null,
    status: "live",
    machine: null,
    summary: null,
    working_on: null,
  };
}

const LIFECYCLE_ROW = {
  id: "life-1",
  tenant_id: "t",
  device_id: "d",
  session_kind: "terminal_shell",
  intent: {},
  state: "active",
  started_at: null,
  last_heartbeat_at: null,
  closed_at: null,
  parent_session_id: null,
  repo: null,
  branch: null,
  provider: null,
} as SessionRow;

const AGENT_ABSENT: AgentHalf = { state: "absent" };
const LIFECYCLE_ABSENT: LifecycleHalf = { state: "absent" };

describe("trap 8 — /sessions/repository is a route, not a session key", () => {
  it("refuses the literal reserved segment", () => {
    expect(isReservedSessionSegment("repository")).toBe(true);
    expect(isReservedSessionSegment("Repository")).toBe(true);
    expect(isReservedSessionSegment(" repository ")).toBe(true);
  });

  it("does not refuse a real key that merely contains the word", () => {
    expect(isReservedSessionSegment("repository-sweep")).toBe(false);
    expect(
      isReservedSessionSegment("aaaaaaaa-0000-0000-0000-000000000001")
    ).toBe(false);
  });

  it("short-circuits the verdict before either half is consulted", () => {
    const verdict = deriveKeyVerdict(
      "repository",
      { state: "loading" },
      { state: "loading" }
    );
    expect(verdict).toEqual({ kind: "reserved", segment: "repository" });
  });

  it("names the shipped surface, so the set cannot silently empty", () => {
    expect([...RESERVED_SESSION_SEGMENTS]).toContain("repository");
  });
});

describe("D4 — every match is rendered when count > 1", () => {
  it("carries ALL resolved cards, in coord's newest-first order", () => {
    const cards = [card("s-3", "brave-otter"), card("s-1", "brave-otter")];
    const verdict = deriveKeyVerdict(
      "brave-otter",
      { state: "resolved", value: { resolved: cards, count: 2 } },
      LIFECYCLE_ABSENT
    );
    expect(verdict.kind).toBe("matches");
    if (verdict.kind !== "matches") throw new Error("unreachable");
    expect(verdict.cards.map((c) => c.id)).toEqual(["s-3", "s-1"]);
  });

  it("does NOT let the lifecycle half narrow an ambiguous name to one", () => {
    // The bridged one would be the tempting pick. Picking it would silently
    // drop the other two sessions that genuinely share the name.
    const cards = [card("s-3", "n"), card("s-2", "n"), card("s-1", "n")];
    const verdict = deriveKeyVerdict(
      "n",
      { state: "resolved", value: { resolved: cards, count: 3 } },
      { state: "resolved", value: LIFECYCLE_ROW }
    );
    if (verdict.kind !== "matches") throw new Error("unreachable");
    expect(verdict.cards).toHaveLength(3);
  });
});

describe("both id spaces", () => {
  it("renders a lifecycle-only session the agent resolver 404s", () => {
    const verdict = deriveKeyVerdict("life-1", AGENT_ABSENT, {
      state: "resolved",
      value: LIFECYCLE_ROW,
    });
    expect(verdict).toEqual({
      kind: "matches",
      cards: [],
      lifecycleOnlyId: "life-1",
    });
  });

  it("waits while either half is still in flight", () => {
    expect(
      deriveKeyVerdict("k", { state: "loading" }, LIFECYCLE_ABSENT).kind
    ).toBe("loading");
    expect(
      deriveKeyVerdict("k", AGENT_ABSENT, { state: "loading" }).kind
    ).toBe("loading");
  });
});

describe("D2 — a read that did not land is not an absence", () => {
  it("claims not-found ONLY when both halves answered no", () => {
    expect(deriveKeyVerdict("k", AGENT_ABSENT, LIFECYCLE_ABSENT).kind).toBe(
      "not-found"
    );
  });

  it("a failed agent half with an absent lifecycle half is UNKNOWN", () => {
    const verdict = deriveKeyVerdict(
      "k",
      { state: "unknown", detail: "502 bad gateway" },
      LIFECYCLE_ABSENT
    );
    expect(verdict.kind).toBe("unknown");
    if (verdict.kind !== "unknown") throw new Error("unreachable");
    expect(verdict.detail).toContain("502");
  });

  it("a failed lifecycle half with an absent agent half is UNKNOWN", () => {
    expect(
      deriveKeyVerdict("k", AGENT_ABSENT, {
        state: "unknown",
        detail: "socket hang up",
      }).kind
    ).toBe("unknown");
  });

  it("classifies a 404 as an ANSWER and anything else as a non-answer", () => {
    expect(classifyAgentError(new AgentSessionsApiError(404, "nope"))).toEqual({
      state: "absent",
    });
    expect(
      classifyAgentError(new AgentSessionsApiError(503, "down")).state
    ).toBe("unknown");
    expect(
      classifyLifecycleError(new SessionsApiError("GET x failed: 404", 404))
    ).toEqual({ state: "absent" });
    expect(
      classifyLifecycleError(new SessionsApiError("GET x failed: 500", 500))
        .state
    ).toBe("unknown");
    // A thrown non-Error (a rejected fetch in some environments) must not be
    // silently swallowed into "absent".
    expect(classifyLifecycleError("boom").state).toBe("unknown");
  });
});
