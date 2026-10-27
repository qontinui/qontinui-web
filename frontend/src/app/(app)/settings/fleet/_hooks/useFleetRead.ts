"use client";

/**
 * One of `/settings/fleet`'s list reads (the test-host designations, the
 * freshness rows, the device list): the rows it last delivered, and what its
 * latest read answered.
 *
 * A failed read must not render as its section's empty sentence (served
 * policy `verification-and-evidence` `unknown-must-not-render-as-a-default`;
 * the console style guide's R6). So each read publishes two verdicts beside
 * its rows:
 *
 * - `unknown`: no read has delivered and one has failed. Nothing is known, and
 *   `rows` (still the initial value) must not be rendered as "none".
 * - `stale`: rows an earlier read delivered, which a newer read failed to
 *   replace. They are real, so they stay on screen, with a label.
 *
 * Both come from the console's `useRetainedValue`. Its read sequence keeps
 * them right when replies overtake each other. On this page the freshness poll
 * and a refresh can be out at once, and so can a refresh and the re-read after
 * a designation write. `failure` is the reason both labels carry: the message
 * of the NEWEST failed read, by issue order. An older read that fails late
 * cannot replace a newer read's reason.
 */

import { useCallback, useRef, useState } from "react";
import { readIsUnknown, useRetainedValue } from "@/components/console";

/** The readable sentence of a failed call. */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface FleetRead<T> {
  /** What the newest delivering read carried; the initial value until one has. */
  rows: T;
  /** No read has delivered, and one has failed: nothing is known. */
  unknown: boolean;
  /** A newer read failed to replace `rows`, which an earlier read delivered. */
  stale: boolean;
  /** Why the newest failed read failed; null while none has. */
  failure: string | null;
  /**
   * Issue one read and record how it ended. A failure is recorded here and
   * then re-thrown, so a caller that reports failures (a toast) still can.
   */
  load: (read: () => Promise<T>) => Promise<void>;
}

export function useFleetRead<T>(initial: T): FleetRead<T> {
  const { value, hasRead, stale, issue, settle } = useRetainedValue<T>(initial);
  const [failure, setFailure] = useState<string | null>(null);
  // The issue number of the read whose failure `failure` holds.
  const failedSeq = useRef(0);

  const load = useCallback(
    async (read: () => Promise<T>) => {
      const seq = issue();
      let rows: T;
      try {
        rows = await read();
      } catch (err) {
        settle(seq, null);
        if (seq > failedSeq.current) {
          failedSeq.current = seq;
          setFailure(errorText(err));
        }
        throw err;
      }
      settle(seq, { value: rows });
    },
    [issue, settle]
  );

  return {
    rows: value,
    unknown: readIsUnknown(hasRead, failure !== null),
    stale,
    failure,
    load,
  };
}
