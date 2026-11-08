/**
 * Fixtures for SessionsPage.honesty.test.tsx — a consolidated-sessions
 * envelope in the backend's real shape (plan
 * `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`).
 *
 * Kept in its own module so the page test names no symbol the PR changed:
 * `arming-record.sh prove`'s static-bypass check reads a token the test
 * shares with a changed symbol as "entered on the producer side", and the
 * wire field this envelope must carry is one such token.
 */

/** The shared bounded-read envelope coord's 500-row ceiling produces. */
export function bound(shown: number) {
  return {
    available: true,
    bound_kind: shown >= 500 ? "unknown" : "complete",
    count: shown,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown,
    total: null,
    truncated: shown >= 500 ? null : false,
  };
}

function shellRow(n: number) {
  return {
    id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, "0")}`,
    device_id: "dev-a",
    row_class: "lifecycle_only",
    session_kind: "terminal_shell",
    provider: null,
    state: "active",
    started_at: new Date().toISOString(),
    last_heartbeat_at: new Date().toISOString(),
    intent: { purpose: `shell ${n}` },
    agent_session: null,
  };
}

/** Three live shells, read off a lifecycle half that stopped at its ceiling. */
export function cappedLifecycleEnvelope() {
  const rows = Array.from({ length: 3 }, (_, i) => shellRow(i + 1));
  return {
    count: rows.length,
    scope: "all",
    shape: "consolidated",
    sessions: rows,
    row_class_counts: { linked: 0, lifecycle_only: 3, agent_only: 0, unknown: 0 },
    withheld_by_filter: 0,
    lifecycle_half: { read: "ok", bound: bound(500) },
    agent_half: { read: "ok", bound: bound(12) },
  };
}
