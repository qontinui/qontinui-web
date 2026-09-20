"use client";

/**
 * The polled-read guard every coord console list needs, spelled ONCE.
 *
 * Lifted out of `/admin/coord/plans` by the review of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, which found the
 * guard implemented twice in that change and then dropped on the three new
 * surfaces that were added next to it. A rule that has to be re-typed per page
 * is a rule that will be missing from the fourth page, and it was.
 *
 * ## What it guards, and why one counter is not enough
 *
 * A polled reader has two independent races, and they want different answers:
 *
 *   - **A superseded SUCCESS repaints a discarded window.** Change the page
 *     size while a read is out and the old read still lands on `setData`,
 *     painting the previous window under the new controls for a whole poll
 *     interval.
 *   - **A superseded success lands on top of a newer FAILURE.** `setError(null)`
 *     clears the banner, `loaded` flips true, and a stale window is stated as
 *     a confident answer to a question that errored. That is the
 *     fabricated-answer class this whole plan exists to close, re-created in a
 *     race window.
 *
 * So there are TWO generations, exactly as `/admin/coord/work-units` documents
 * at length:
 *
 *   - `questionGen` — bumped once per QUESTION (a window or filter change,
 *     i.e. whenever `read`'s identity changes). It gates the ERROR: "this read
 *     failed" is true of the question currently on screen whether or not a
 *     newer request has overtaken it, so an overtaken failure still speaks.
 *     A single per-request counter silences the failure in every arm, and
 *     under a slow or retrying backend — `httpClient`'s timeout is 60 s and
 *     its 5xx retry spends ~7 s in backoff — every read is superseded before
 *     it settles and the page waits forever with nothing to show.
 *   - `reqGen` — bumped per CALL. It additionally gates the DATA, so two
 *     overlapping reads cannot land out of order.
 *
 * `pollInFlight` is the third piece: one read at a time per question, so a
 * tick cannot stack on a tick, and a refresh CLICK takes the same lock when it
 * is free.
 *
 * The residue is the asymmetry `/questions` states and accepts: a stale
 * FAILURE landing after a fresh success shows a banner the newest read
 * disagrees with. That fails safe — it over-reports trouble — where the
 * opposite silences it.
 *
 * ## How a caller uses it
 *
 * `read` receives a {@link ReadGuard} and must consult it before every
 * `setState`. The hook cannot do that for the caller: which state a read sets,
 * and in which arm, is the page's own business (the reconciliation page holds
 * a third `violations` state that is neither data nor error).
 *
 * ```ts
 * const read = useCallback(
 *   async (guard: ReadGuard) => {
 *     try {
 *       const body = await httpClient.get<T>(url);
 *       if (!guard.isNewest()) return;
 *       setData(body);
 *       setError(null);
 *     } catch (e) {
 *       if (!guard.isCurrentQuestion()) return;
 *       setError(String(e));
 *     }
 *   },
 *   [offset, limit]
 * );
 * const onQuestionChange = useCallback(() => {
 *   setData(null);
 *   setError(null);
 * }, []);
 * const { refresh } = useGuardedPoll({ read, intervalMs, onQuestionChange });
 * ```
 *
 * Both callbacks must be `useCallback`-stable: `read`'s dependencies ARE the
 * question, and an unstable `onQuestionChange` would blank the page on every
 * render.
 */

import { useCallback, useEffect, useRef } from "react";

export interface ReadGuard {
  /**
   * Nothing newer has been issued for this question, so the read may set the
   * DATA. Consult before `setData` / clearing the error on a success.
   */
  isNewest(): boolean;
  /**
   * The question this read was issued under is still the one on screen, so
   * the read may report a FAILURE — even if a newer request has overtaken it.
   */
  isCurrentQuestion(): boolean;
}

export interface GuardedPoll {
  /**
   * Issue a read NOW, taking the in-flight lock when it is free so a poll tick
   * cannot stack on top of it.
   *
   * `also` runs a SECOND, unguarded read alongside it under the same lock —
   * the plans page refreshes its capture census beside the reconciliation,
   * because a stale census next to a fresh reconciliation is the misreading
   * that page exists to stop. It is passed explicitly rather than folded into
   * `read` so the guard still applies to exactly one of them.
   *
   * Returns the settled read, which is what `<RefreshButton>` stays busy for.
   */
  refresh(also?: () => Promise<unknown>): Promise<unknown>;
}

export function useGuardedPoll({
  read,
  intervalMs,
  onQuestionChange,
}: {
  /** Stable per QUESTION — its dependencies are the window/filter controls. */
  read: (guard: ReadGuard) => Promise<unknown>;
  intervalMs: number;
  /**
   * Run when the question changes, BEFORE the first read of the new one. The
   * place to drop rows that answer a question nobody asked: `loaded` is
   * `data !== null`, so keeping them leaves every read-state derivation
   * reporting the OLD question while the new one is in flight.
   */
  onQuestionChange?: () => void;
}): GuardedPoll {
  const questionGen = useRef(0);
  const reqGen = useRef(0);
  const pollInFlight = useRef(false);

  const issue = useCallback(() => {
    const question = questionGen.current;
    const req = ++reqGen.current;
    return read({
      isNewest: () =>
        question === questionGen.current && req === reqGen.current,
      isCurrentQuestion: () => question === questionGen.current,
    });
  }, [read]);

  useEffect(() => {
    // `read`'s identity IS the question, so this effect re-runs exactly when
    // the question changes — and that is the one place the generation moves.
    questionGen.current += 1;
    const question = questionGen.current;
    const release = () => {
      // Only the question that took the lock may release it: a read belonging
      // to a question the operator has left must not unlock the new one's.
      if (question === questionGen.current) pollInFlight.current = false;
    };
    onQuestionChange?.();
    pollInFlight.current = true;
    void issue().finally(release);
    const id = setInterval(() => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      void issue().finally(release);
    }, intervalMs);
    return () => {
      clearInterval(id);
      pollInFlight.current = false;
    };
  }, [issue, intervalMs, onQuestionChange]);

  const refresh = useCallback(
    (also?: () => Promise<unknown>) => {
      const tookLock = !pollInFlight.current;
      if (tookLock) pollInFlight.current = true;
      const question = questionGen.current;
      const running = also
        ? Promise.all([issue(), also()])
        : Promise.resolve(issue());
      return running.finally(() => {
        if (tookLock && question === questionGen.current) {
          pollInFlight.current = false;
        }
      });
    },
    [issue]
  );

  return { refresh };
}
