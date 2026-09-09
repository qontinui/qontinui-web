/**
 * "Did the latest read replace what is on screen?" — as a comparison of
 * sequences, for any surface that RETAINS a value across a failed read.
 *
 * Sibling of `readFailure.ts`, and it exists for the same reason: several
 * surfaces have to reach the same verdict about the same read, and two
 * spellings drift invisibly. `CoordNav`'s two tab badges and
 * `/admin/coord/notifications` both retain coord's scalars and both owe R6's
 * stale arm — *"those numbers are real and still actionable, so they keep
 * rendering **and the detail line says they are old**"* — and the second half
 * is what a retained value ships without.
 *
 * ## Why a sequence rather than a boolean
 *
 * The obvious spelling is a flag set in the `catch` and cleared in the success
 * path. On any poller whose replies can overtake each other it is wrong in
 * BOTH directions, and both were shipped and reverted before this module
 * existed:
 *
 *  - a superseded REJECTION landing after a newer success re-stales a number
 *    that was just refreshed;
 *  - and the obvious guard for that — ignore anything but the newest request
 *    *issued* — throws away a superseded but SUCCESSFUL read. Poll A hangs,
 *    poll B fails, A then answers with a real number, and the surface discards
 *    it and renders nothing. That is information loss, the exact opposite of
 *    the stale arm it is trying to implement.
 *
 * Two counters get both right. `completed` is the newest read that finished,
 * `delivered` the newest that carried a value, and **stale ⇔ delivered <
 * completed**: a newer read finished and did not replace what is displayed.
 *
 * Note this is NOT the generation guard a list route uses for its filters
 * (`notifications/page.tsx`'s `queryGenRef`, and `/plans` before it). There, a
 * superseded reply answers a DIFFERENT question and must be discarded. Here
 * every read asks the same question, so an older *answer* is still an answer.
 *
 * ## What "stale" does and does not say
 *
 * It says the most recent completed read did not replace this value. It says
 * nothing about WHY — a rejection and a 2xx that carried no scalar are the same
 * fact about the number, and a surface that guesses between them ends up
 * printing "the most recent poll failed" over a read that returned 200.
 *
 * It also does not cover a read that never RAN: a poller gated on tab
 * visibility can leave a value hours old with nothing stale about it. That is a
 * clock, which is a different feature.
 */

export interface ReadSequence {
  /** Take a ticket before issuing a read. */
  issue(): number;
  /**
   * Record how one read finished.
   *
   * @param seq        the ticket from `issue()`
   * @param didDeliver whether this response carried the value
   * @param counts     whether this read is one the value was EXPECTED from.
   *   `false` for a response that can deliver the value without its SILENCE
   *   meaning anything — a write's response, say, which returns the scalar as
   *   a courtesy and is not a read of the feed. Such a reply can un-stale a
   *   surface but must never stale one.
   * @returns whether the caller should apply this response's value — false for
   *   a reply an even newer delivery has already superseded.
   */
  settle(seq: number, didDeliver: boolean, counts?: boolean): boolean;
  /** True when a newer read finished without replacing the displayed value. */
  isStale(): boolean;
  /** Has any read ever delivered? A value never read has nothing to qualify. */
  hasDelivered(): boolean;
}

export function createReadSequence(): ReadSequence {
  let issued = 0;
  let delivered = 0;
  let completed = 0;

  return {
    issue: () => (issued += 1),
    settle(seq, didDeliver, counts = true) {
      if (counts) completed = Math.max(completed, seq);
      // `>=` rather than `>`: an out-of-order success must not overwrite a
      // newer one. A given ticket settles once, so equality is not a real case
      // — it is written this way so the first delivery (seq 1 against the
      // initial 0) is not a special case.
      if (didDeliver && seq >= delivered) {
        delivered = seq;
        return true;
      }
      return false;
    },
    // `hasDelivered() &&` is not redundant: without it the first read to finish
    // without delivering reports "from an earlier read" when there has been no
    // read. UNKNOWN and STALE are different claims with different remedies.
    isStale: () => delivered > 0 && delivered < completed,
    hasDelivered: () => delivered > 0,
  };
}
