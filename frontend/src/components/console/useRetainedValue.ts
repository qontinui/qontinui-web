"use client";

/**
 * One retained value, and the honest answer to "did the latest read refresh
 * it?" — the React shell around `readSequence.ts`.
 *
 * ## Why this is a shared module rather than a local helper
 *
 * It was born inside `CoordNav.tsx`, private to the two tab badges. Then the
 * nav's THIRD poller — `useFleetAlarmBadge`, five counts on the `Dev Ops ▾`
 * trigger — turned out to owe the same bookkeeping, and it lives in its own
 * module that `CoordNav` imports. Leaving the hook where it was would have
 * meant either an import cycle (`CoordNav` → `useFleetAlarmBadge` → `CoordNav`)
 * or a second spelling of it, and a second spelling is exactly the drift
 * `readSequence.ts` was extracted to stop, one level up.
 *
 * ## What it is for
 *
 * Any surface that KEEPS its last good value across a failed read owes R6's
 * stale arm — *"those numbers are real and still actionable, so they keep
 * rendering **and the detail line says they are old**"*. Retaining is the easy
 * half and the one that ships; this hook makes the other half falsifiable, by
 * publishing `stale` beside the value so a renderer cannot forget to qualify
 * it.
 *
 * The arithmetic is `readSequence.ts` — imported, not re-spelled. That module
 * carries the argument for why staleness is a comparison of SEQUENCES rather
 * than a flag set in a `catch`, and both wrong answers that produced it. This
 * is state for what renders, refs for what settles.
 *
 * ## One axis per independently-failing read
 *
 * Give each read that can fail on its own its own `useRetainedValue`. Two
 * numbers behind one flag is how a surface ends up claiming a fresh read for a
 * value the read never touched — measured twice in this lineage, once on the
 * alerts badge's critical accent and once on the fleet alarm's admission
 * counts.
 */

import { useCallback, useRef, useState } from "react";
import { createReadSequence, type ReadSequence } from "./readSequence";

export interface RetainedValue<T> {
  /** The last delivered value, or the initial one if none ever landed. */
  value: T;
  /** Has any read ever delivered? A value never read has nothing to qualify. */
  hasRead: boolean;
  /** True when a newer read finished without replacing `value`. */
  stale: boolean;
  /** Take a ticket before issuing a read. */
  issue: () => number;
  /**
   * Record how one read finished. Pass `null` for a read that delivered
   * nothing — a rejection, or a 2xx that carried no value; both are the same
   * fact about the number and both stale it.
   *
   * Deliberately narrower than `ReadSequence.settle`, which also takes a
   * `counts` flag for a response that may deliver the value without its
   * SILENCE meaning anything (a write's courtesy scalar). Every caller of THIS
   * hook polls a feed, where every reply is a read; surfacing an argument none
   * of them passes would be dead wiring, and adding it back is one line the day
   * a retained value here is fed by a write.
   *
   * @returns whether this response's value was applied — false for a reply an
   *   even newer delivery has already superseded.
   */
  settle: (seq: number, delivered: { value: T } | null) => boolean;
}

export function useRetainedValue<T>(initial: T): RetainedValue<T> {
  const [value, setValue] = useState<T>(initial);
  const [hasRead, setHasRead] = useState(false);
  const [stale, setStale] = useState(false);
  // The sequence lives in a ref: `settle` has to read its own writes in the
  // same tick, and state does not update synchronously.
  const seqRef = useRef<ReadSequence | null>(null);
  if (seqRef.current === null) seqRef.current = createReadSequence();

  // Re-exported rather than left to each caller's own counter. Callers minted
  // their own once, which was correct and a footgun: the module's `issued`
  // stayed at zero forever, so anyone reaching for `issue()` on another axis
  // would get `1`, fail `seq >= delivered` after the first poll, and have their
  // reads SILENTLY declined — no error, no failing test.
  const issue = useCallback(() => seqRef.current!.issue(), []);

  const settle = useCallback(
    (seq: number, delivered: { value: T } | null): boolean => {
      const sequence = seqRef.current!;
      const applied = sequence.settle(seq, delivered !== null);
      if (applied && delivered) setValue(delivered.value);
      // Mirrored from the module rather than tracked a second time — two
      // spellings of one fact is the drift that module exists to stop, and a
      // hook that re-spells it is that drift one level up. It is React state
      // because the renderer re-renders on it; the ANSWER is the module's.
      setHasRead(sequence.hasDelivered());
      setStale(sequence.isStale());
      return applied;
    },
    []
  );

  return { value, hasRead, stale, issue, settle };
}
