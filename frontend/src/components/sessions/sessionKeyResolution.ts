/**
 * sessionKeyResolution — what `/sessions/[key]` is allowed to conclude from a
 * URL segment.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` D4 + trap 8. Pure: no
 * React, no fetch. The reads are injected, so every conclusion below is
 * testable without a network.
 *
 * ## D4 — a key spans BOTH id spaces AND names, and names are ambiguous
 *
 * Coord already resolves this way and the shape of its answer is the whole
 * point: `GET /api/v1/admin/agent-sessions/{key}` returns
 * `{"resolved": [...], "count": N}` newest-first **because a name can match
 * several sessions**, and `coord.sessions` resolves
 * `id = $1 OR claude_code_session_id = $1` on its own side. So a key is one of
 * four things and the page must not pretend otherwise:
 *
 * | the key is | resolved by |
 * |---|---|
 * | a `coord.agent_sessions.id` (the `claude --session-id` uuid) | the agent resolver |
 * | a session NAME or label | the agent resolver — possibly to MANY cards |
 * | a `coord.sessions.id` | the lifecycle read |
 * | a `coord.sessions.claude_code_session_id` | either, coord bridges it |
 *
 * **`count > 1` renders every match.** Collapsing to `resolved[0]` would show
 * one session's transcript under another session's name, and the operator
 * would have no way to know. `/environments/sessions/[key]` already does the
 * right thing today; this is that behaviour carried onto the merged route, not
 * a new invention.
 *
 * ## Trap 8 — `repository` is a RESERVED segment, not a session key
 *
 * `/sessions/repository` and `/sessions/repository/[id]` are the shipped
 * permanent-transcript surface, and they live inside the namespace `[key]` is
 * added to. Next.js App Router resolves a static segment ahead of a dynamic
 * sibling, so the FILESYSTEM side is safe — but nothing stops a hand-built
 * link, a stale bookmark or a future `redirects()` rewrite from delivering the
 * literal string `"repository"` to this resolver, and asking coord to resolve
 * a session named `repository` would render a "no session matches" page over a
 * route that exists. {@link isReservedSessionSegment} refuses it by name.
 *
 * ## Two axes again (D2)
 *
 * Each half of the join answers for itself: `absent` is coord SAYING no such
 * row (a 404), `unknown` is a read that did not land. They render differently
 * and neither may be reported as the other — the same split
 * `console/readFailure.ts` draws for a list, applied per half.
 */

import {
  AgentSessionsApiError,
  type ResolveSessionResponse,
  type SessionCard,
} from "@/services/agent-sessions-api";
import { SessionsApiError } from "./api";
import type { SessionRow } from "./types";

/**
 * Static segments under `/sessions/` that are NOT session keys.
 *
 * `repository` is the shipped permanent-transcript corpus (plan §2 surface
 * #6). Anything added as a static sibling of `[key]` belongs here too, and the
 * route test asserts the set against the filesystem so the two cannot drift.
 */
export const RESERVED_SESSION_SEGMENTS: ReadonlySet<string> = new Set([
  "repository",
]);

/** Is this URL segment a reserved static route rather than a session key? */
export function isReservedSessionSegment(key: string): boolean {
  return RESERVED_SESSION_SEGMENTS.has(key.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// One half's answer
// ---------------------------------------------------------------------------

/**
 * What one half of the resolve said.
 *
 * `absent` is coord's 404 — an ANSWER. `unknown` is any other failure, which
 * is not one. A page that renders the second as the first tells an operator
 * their session does not exist because a proxy blipped.
 */
export type HalfResult<T> =
  | { state: "loading" }
  | { state: "resolved"; value: T }
  | { state: "absent" }
  | { state: "unknown"; detail: string };

/** The agent half — `{resolved, count}`, newest-first, possibly MANY. */
export type AgentHalf = HalfResult<ResolveSessionResponse>;
/** The lifecycle half — one `coord.sessions` row. */
export type LifecycleHalf = HalfResult<SessionRow>;

/** Classify a thrown agent-resolver error into an answer or a non-answer. */
export function classifyAgentError(err: unknown): AgentHalf {
  if (err instanceof AgentSessionsApiError && err.status === 404) {
    return { state: "absent" };
  }
  return { state: "unknown", detail: errorDetail(err) };
}

/** Classify a thrown lifecycle-read error into an answer or a non-answer. */
export function classifyLifecycleError(err: unknown): LifecycleHalf {
  if (err instanceof SessionsApiError && err.status === 404) {
    return { state: "absent" };
  }
  return { state: "unknown", detail: errorDetail(err) };
}

// ---------------------------------------------------------------------------
// The page's verdict
// ---------------------------------------------------------------------------

/**
 * What `/sessions/[key]` should render, derived from both halves at once.
 *
 * `matches` is the list D4 requires be rendered in FULL. `notFound` is only
 * reachable when BOTH halves answered and both said no — one half answering
 * and the other failing can never produce it, because "we could not ask" is
 * not evidence of absence.
 */
export type KeyVerdict =
  | { kind: "reserved"; segment: string }
  | { kind: "loading" }
  | { kind: "matches"; cards: SessionCard[]; lifecycleOnlyId: string | null }
  | { kind: "not-found" }
  | { kind: "unknown"; detail: string };

export function deriveKeyVerdict(
  key: string,
  agent: AgentHalf,
  lifecycle: LifecycleHalf
): KeyVerdict {
  if (isReservedSessionSegment(key)) {
    return { kind: "reserved", segment: key };
  }
  if (agent.state === "loading" || lifecycle.state === "loading") {
    return { kind: "loading" };
  }

  if (agent.state === "resolved" && agent.value.resolved.length > 0) {
    // D4: EVERY match, newest-first, exactly as coord ordered them. The
    // lifecycle half is not consulted to narrow this — a name matching three
    // sessions is three sessions, and picking the one that happens to carry a
    // `coord.sessions` row would silently drop the other two.
    return {
      kind: "matches",
      cards: agent.value.resolved,
      lifecycleOnlyId: null,
    };
  }

  if (lifecycle.state === "resolved") {
    // No agent card, but coord has a lifecycle row: a `lifecycle_only`
    // session (a shell, a workflow, an automation — no Claude session id at
    // all), or a bridged row the agent resolver could not carry. Either way
    // the page renders, with the agent half's sections saying which unknown
    // they are rather than going blank.
    return {
      kind: "matches",
      cards: [],
      lifecycleOnlyId: lifecycle.value.id,
    };
  }

  if (agent.state === "unknown" || lifecycle.state === "unknown") {
    // At least one half never answered. Absence is not established.
    const detail =
      agent.state === "unknown"
        ? agent.detail
        : lifecycle.state === "unknown"
          ? lifecycle.detail
          : "";
    return { kind: "unknown", detail };
  }

  // Both halves answered, both said no such row. This is the only path that
  // may claim the key does not resolve.
  return { kind: "not-found" };
}

function errorDetail(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err ?? "unknown error");
}
