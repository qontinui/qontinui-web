/**
 * Strategy Collaboration — Phase 2.4 presence heartbeat driver.
 *
 * Plan reference: `plans/2026-05-17-strategy-phase-2.md` §2.4.
 *
 * Posts `/api/v1/strategy/presence/heartbeat` every 30 s while the
 * hook is mounted. The response carries the canonical `doc_id`
 * (coord resolves doc_name → doc_id via PG) which the frontend
 * surfaces via the optional `onDocId` callback so sub-components
 * (e.g. `<PresenceIndicator>`) can subscribe to the per-doc aggregate
 * channel.
 *
 * Cadence locked per the plan's vet checklist: heartbeat 30 s, coord-
 * side TTL 90 s (2-miss tolerance), aggregator publishes ONLY on
 * viewer-count delta.
 *
 * Heartbeat fires immediately on mount so the first aggregate event
 * includes this user without a 30 s delay.
 */

import { useEffect, useState } from "react";

export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Path on the web backend. The proxy in
 *  `backend/app/api/v1/endpoints/strategy.py` forwards to coord. */
const HEARTBEAT_PATH = "/api/v1/strategy/presence/heartbeat";

export interface HeartbeatResponse {
  doc_id: string;
}

/**
 * Fire a single heartbeat. Exported for tests + the WS-reconnect path.
 * The response carries the canonical doc_id (coord resolves it from
 * `strategy.documents.relative_path`); returns null on a non-200
 * response (the heartbeat is fire-and-forget so transient failures
 * don't propagate).
 */
export async function sendHeartbeat(
  docName: string,
): Promise<HeartbeatResponse | null> {
  const res = await fetch(HEARTBEAT_PATH, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_name: docName }),
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as HeartbeatResponse;
  } catch {
    return null;
  }
}

interface UsePresenceHeartbeatOptions {
  /** Substrate-relative path (e.g. `README.md`). Coord resolves to a
   *  doc_id via PG and echoes it in the response so consumers can
   *  subscribe to the per-doc aggregate channel. */
  docName: string;
  /** Pause beats without unmounting. Defaults to true. */
  enabled?: boolean;
  /** Test seam — defaults to `sendHeartbeat`. */
  send?: (docName: string) => Promise<HeartbeatResponse | null>;
  /** Test seam — defaults to the constant. */
  intervalMs?: number;
}

/**
 * Drives presence heartbeats for a single doc. Returns the resolved
 * `doc_id` (from the first successful heartbeat response) so callers
 * can pass it to channel-keyed subscribers. Returns `null` until the
 * first response lands.
 *
 * Idempotent on rerender (same `docName` + `enabled` = same interval);
 * changes restart cleanly.
 */
export function usePresenceHeartbeat(
  opts: UsePresenceHeartbeatOptions,
): string | null {
  const {
    docName,
    enabled = true,
    send = sendHeartbeat,
    intervalMs = HEARTBEAT_INTERVAL_MS,
  } = opts;
  const [docId, setDocId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !docName) return;
    setDocId(null);

    let cancelled = false;
    const fire = () => {
      send(docName)
        .then((resp) => {
          if (cancelled || !resp) return;
          setDocId((prev) => (prev === resp.doc_id ? prev : resp.doc_id));
        })
        .catch(() => {
          /* fire-and-forget */
        });
    };

    fire();
    const id = setInterval(fire, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [docName, enabled, send, intervalMs]);

  return docId;
}
