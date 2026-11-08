/**
 * useStampedFailure — the latest read failure for EACH question, kept apart
 * from every other question and from replies that arrive out of order.
 *
 * Each subprojects read answers a question with a stamp: a list view's tab,
 * a detail page's id, the home line's one count. A failure is recorded with
 * the stamp and the sequence number of the read that failed, and it is
 * cleared only by a SUCCESS for the same stamp issued AFTER it. Three things
 * this rules out, all met on these pages:
 *
 * - an older read that succeeds after a newer one failed. `useRetainedValue`
 *   applies that reply (it is newer than the last delivery) and still reports
 *   the value stale, so clearing the failure on "applied" would leave a stale
 *   value with no reason beside it;
 * - a reply for another tab or id clearing — or setting — this one's failure;
 * - a failure for another tab or id REPLACING this one's: each stamp keeps its
 *   own, so coming back to a tab whose last read failed still says so while
 *   its re-read is out.
 *
 * A failure older than the newest success for its stamp is ignored: that
 * question has been answered since.
 */

import { useCallback, useRef, useState } from "react";
import type { SubprojectReadFailure } from "./subprojectStatus";

interface Recorded {
  seq: number;
  failure: SubprojectReadFailure;
}

export interface StampedFailure<S> {
  /** The failure recorded for `stamp`, or `null`. */
  failureFor: (stamp: S) => SubprojectReadFailure | null;
  /** Record that read `seq` for `stamp` failed. */
  fail: (stamp: S, seq: number, failure: SubprojectReadFailure) => void;
  /** Record that read `seq` for `stamp` answered. */
  succeed: (stamp: S, seq: number) => void;
}

export function useStampedFailure<S>(): StampedFailure<S> {
  const [failures, setFailures] = useState<ReadonlyMap<S, Recorded>>(
    () => new Map()
  );
  /** The newest answered read per stamp. */
  const answered = useRef(new Map<S, number>());

  const fail = useCallback(
    (stamp: S, seq: number, failure: SubprojectReadFailure) => {
      if ((answered.current.get(stamp) ?? 0) > seq) return;
      setFailures((prev) => {
        const held = prev.get(stamp);
        if (held !== undefined && held.seq > seq) return prev;
        const next = new Map(prev);
        next.set(stamp, { seq, failure });
        return next;
      });
    },
    []
  );

  const succeed = useCallback((stamp: S, seq: number) => {
    if ((answered.current.get(stamp) ?? 0) < seq)
      answered.current.set(stamp, seq);
    setFailures((prev) => {
      const held = prev.get(stamp);
      if (held === undefined || held.seq > seq) return prev;
      const next = new Map(prev);
      next.delete(stamp);
      return next;
    });
  }, []);

  const failureFor = useCallback(
    (stamp: S) => failures.get(stamp)?.failure ?? null,
    [failures]
  );

  return { failureFor, fail, succeed };
}
