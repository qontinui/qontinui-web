/**
 * What a failed read says in front of an outsider (plan
 * `2026-10-23-console-presentation-spaces` Phase 7, D3.3).
 *
 * A Dev Ops panel whose read failed says so — UNKNOWN is never rendered as
 * zero, empty or healthy. For the operator the reason is the read's own text:
 * `httpClient`'s `GET <url> failed: <status> - <body>`, coord's error body, or
 * a sentence built around what coord said. None of that was written for an
 * outsider: a URL can carry a resource key, and a body or a coord `reason` can
 * name a machine, a repository or a person. So in presentation mode the panel
 * still states that its read failed, and the reason itself is replaced by
 * fixed words.
 *
 * Unlike `RedactedText`, nothing here is ever cleared for display: a failure
 * reason belongs to no repository a scope could vouch for, so every arm
 * withholds. Pure — the caller passes the mode.
 */

/** Stands in for a failure reason inside a sentence: "unavailable: <this>." */
export const FAILURE_REASON_WITHHELD = "reason withheld in presentation mode";

/** Stands in for a failure reason that is a sentence of its own. */
export const FAILURE_SENTENCE_WITHHELD =
  "Why it failed is withheld in presentation mode.";

/**
 * `reason` for the operator; {@link FAILURE_REASON_WITHHELD} while presenting.
 * `null` (no failure) stays `null` in both modes, so a caller's "did it fail?"
 * test reads the same either way.
 */
export function presentedFailureReason<T extends string | null>(
  reason: T,
  presenting: boolean
): T | typeof FAILURE_REASON_WITHHELD {
  return reason === null || !presenting ? reason : FAILURE_REASON_WITHHELD;
}
