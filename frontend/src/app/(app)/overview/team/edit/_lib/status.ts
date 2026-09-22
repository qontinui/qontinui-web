/**
 * What the estimate editor is currently saying about the last save, and the
 * one rule that decides when it stops saying it.
 *
 * Pure and out of the component because the rule is the whole substance:
 * two reviews found it wrong in both directions, and neither time was there
 * anything to run against it.
 */

export type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  /** Carries the version that landed, so the message can name it. */
  | { kind: "saved"; version: number }
  | { kind: "conflict"; currentVersion: number | null }
  | { kind: "failed"; message: string };

/**
 * The status after the working copy is edited.
 *
 * Two mistakes to avoid, and they pull opposite ways:
 *
 * - Clearing nothing leaves "Saved as version N" over a draft that version
 *   does not contain — a false statement about the server, which is worse
 *   than no statement.
 * - Clearing everything takes `saving` with it. That attempt is still IN
 *   FLIGHT: re-enabling Save mid-request puts a second submit one click
 *   away, and when the first resolves its banner describes a draft the
 *   request never carried.
 *
 * So: a FINISHED attempt is cleared, an unfinished one is left alone. The
 * `idle` arm returns the same object rather than a new one, so React bails
 * out of the re-render instead of doing one for nothing.
 */
export function statusAfterEdit(current: Status): Status {
  return current.kind === "saving" || current.kind === "idle"
    ? current
    : { kind: "idle" };
}
