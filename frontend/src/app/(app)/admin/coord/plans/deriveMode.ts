/**
 * coord's decay-detection posture, as the caveat beside the "needs a /vet-imp"
 * signal.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` Phase 3.
 * `vet_state` — the half of the predicate that catches a vetted plan whose
 * body has since moved — is computed by coord's derive worker, whose mode
 * (`COORD_WORKUNIT_DERIVE_MODE`) is PROCESS-wide. So the caveat speaks of the
 * coord deployment, never "this tenant": claiming per-tenant would assert more
 * than coord knows.
 *
 * Read from `GET /api/v1/operations/plans/overview` `derive_mode`:
 *
 * - `live` → no caveat.
 * - `shadow` → the signal may be stale, said in words.
 * - field ABSENT → an older coord: "decay-detection mode UNKNOWN". Never read
 *   as live — an absent posture is not a healthy one.
 * - read failed / not yet answered → UNKNOWN as well, naming why.
 */

export type DeriveModeState =
  | { state: "pending" }
  | { state: "failed"; reason: string }
  | { state: "loaded"; mode: unknown };

export interface DeriveModeReading {
  kind: "pending" | "failed" | "absent" | "shadow" | "live" | "unrecognised";
  /** The sentence to show beside the signal, or `null` for none. */
  caveat: string | null;
}

export const SHADOW_CAVEAT =
  "decay detection runs in shadow mode on this coord deployment — this signal may be stale";

export const UNKNOWN_CAVEAT = "decay-detection mode UNKNOWN";

/** Pull `derive_mode` out of an overview body without trusting its shape. */
export function deriveModeOf(body: unknown): unknown {
  if (body === null || typeof body !== "object") return undefined;
  return (body as Record<string, unknown>).derive_mode;
}

export function describeDeriveMode(s: DeriveModeState): DeriveModeReading {
  if (s.state === "pending") {
    return {
      kind: "pending",
      caveat: `${UNKNOWN_CAVEAT} — coord's overview has not answered yet`,
    };
  }
  if (s.state === "failed") {
    return {
      kind: "failed",
      caveat: `${UNKNOWN_CAVEAT} — coord's overview could not be read (${s.reason})`,
    };
  }
  if (s.mode === undefined || s.mode === null) {
    return {
      kind: "absent",
      caveat: `${UNKNOWN_CAVEAT} — this coord's overview does not report it (older coord)`,
    };
  }
  if (s.mode === "live") return { kind: "live", caveat: null };
  if (s.mode === "shadow") return { kind: "shadow", caveat: SHADOW_CAVEAT };
  return {
    kind: "unrecognised",
    caveat: `${UNKNOWN_CAVEAT} — coord reported a mode this console does not know ("${String(s.mode)}")`,
  };
}
