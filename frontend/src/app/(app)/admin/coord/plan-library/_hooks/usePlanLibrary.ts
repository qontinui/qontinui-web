"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { httpClient } from "@/services/service-factory";
import { useRetainedValue } from "@/components/console";
import type { ScanRootListResponse } from "../types";

const API = "/api/v1/plan-library";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * One route, read on mount and again on every `reload`, whose last good answer
 * is KEPT across a failed read — the plumbing the scan-source and coverage panels share.
 *
 * Built on the console's `useRetainedValue` rather than a private newest-id
 * guard, which is what each hook carried before. Reads DO overlap, even with a
 * panel's Refresh disabled while one is out: React StrictMode runs the mount
 * effect twice in development, and nothing stops a second caller. No read
 * here passes an AbortController signal (which `http-client.ts` now honours),
 * so overlapping reads BOTH settle. A newest-id guard
 * handles two of the three orderings and loses the third: read A is out, a
 * newer read B FAILS, then A answers with real data — and is thrown away,
 * leaving the panel saying nothing could be read although something was.
 * `readSequence.ts` documents exactly that loss, and it is why the primitive
 * compares sequences instead.
 *
 * * `data` / `fetchedAt` — the newest DELIVERED answer, and the wall-clock at
 *   which its request left. Neither moves on a failed read, so a panel keeps
 *   the rows and can say they may be stale rather than blanking them.
 * * `error` — set exactly when what is on screen is not the answer to the
 *   latest read that finished: a newer read failed after it (`stale`), or no
 *   read has ever delivered and one failed. A late failure behind a newer
 *   success never raises it. A late success behind a newer failure keeps it,
 *   because the data shown is older than the read that failed.
 * * `loading` — true until the NEWEST read settles, so an older one landing
 *   first cannot re-enable Refresh while a read is still out.
 */
function useRetainedRead<T>(url: string, failureMessage: string) {
  const answer = useRetainedValue<{ data: T; fetchedAt: Date } | null>(null);
  const { issue, settle } = answer;
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const newestIssued = useRef(0);
  const newestFailed = useRef(0);

  const load = useCallback(async () => {
    const ticket = issue();
    newestIssued.current = ticket;
    setLoading(true);
    // Taken BEFORE the await, not after. The server computed any ages in this
    // response at some point after the request left, so stamping the moment it
    // LANDED would make every reading look up to one round trip fresher than
    // it is. On this fleet that round trip has been sampled in seconds, not
    // milliseconds, so it is not always negligible — and erring early is the
    // honest side for an age.
    const requestedAt = new Date();
    try {
      const data = await httpClient.get<T>(url);
      settle(ticket, { value: { data, fetchedAt: requestedAt } });
    } catch (err) {
      settle(ticket, null);
      // Keep the NEWEST failure's words: an older read failing late must not
      // replace them.
      if (ticket > newestFailed.current) {
        newestFailed.current = ticket;
        setFailure(message(err, failureMessage));
      }
    } finally {
      if (newestIssued.current === ticket) setLoading(false);
    }
  }, [issue, settle, url, failureMessage]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    data: answer.value?.data ?? null,
    fetchedAt: answer.value?.fetchedAt ?? null,
    loading,
    error: answer.stale || !answer.hasRead ? failure : null,
    reload: load,
  };
}

/**
 * Every reporting device's latest reading of the tree its body sync scans.
 *
 * One read, no polling — it answers half of one question ("where is the
 * corpus coming from" / "how current is what it was read from"; the capture
 * census on `/admin/coord/plans` answers the other half), and an operator
 * re-asks it with the Refresh on its panel. `/admin/coord/plans`' corpus-health
 * summary is a second consumer of this cheap `coverage=false` read; the costly
 * coverage read stays single-consumer.
 *
 * On failure `data` is left at whatever was last read and `error` is set, so
 * the panel can say the rows may be stale rather than blanking them. The
 * absent case is NOT modelled as an empty list here: the route answers
 * `state: "unknown"` with rows `[]` for an organization no device has reported
 * for, and that distinction is the point of the route.
 *
 * `fetchedAt` is the wall-clock at which `data`'s request left. The route's
 * `observation_age_secs`, `observation_fresh` and `fresh_count` are
 * server-computed deltas FROZEN at that instant, and this hook does not poll —
 * so without a stamp a console left open overnight keeps rendering "heard 30s
 * ago". That is the very defect this feature exists to remove, reappearing one
 * level up, at the panel instead of the row. The panel renders it beside the
 * summary.
 *
 * `coverage=false`: `ScanSourcesPanel` renders no coverage field at all, so
 * this asks the route to skip the stem census load and the corpus anti-join
 * — see [`usePlanCoverage`], whose own read pays that cost. Before this
 * parameter existed the two hooks were two full-cost reads of one route per
 * mount of this page; `data.coverage` here is always `[]`.
 */
export function useScanRoots() {
  return useRetainedRead<ScanRootListResponse>(
    `${API}/scan-roots?coverage=false`,
    "Failed to load scan sources"
  );
}

/**
 * What the corpus HOLDS against what EXISTS, per scan source — the coverage
 * set difference.
 *
 * Reads the same route as [`useScanRoots`] and is deliberately a separate
 * hook rather than a second consumer of one shared read, so this is still TWO
 * HTTP round trips per mount of `/admin/coord/plan-library` — but only ONE of
 * them pays the server-side coverage computation. `GET /scan-roots` is the
 * one route that computes the set difference, and serving it means: the
 * census-LOADING observation read, which UNDEFERS the two stem JSONB columns
 * (~208 KB per device for both sides at 1837 stems, per the measurement on
 * `crud.plan_scan_root.list_observations`), plus the corpus statement over
 * every `kind = 'plan'` row in the organization. [`useScanRoots`] asks with
 * `?coverage=false`, which is exactly the concentrated cost design decision
 * D2 moved onto this route and off `corpus_health` — that panel renders no
 * coverage field at all, so it should not be the one paying for it either.
 * Before the parameter existed, mounting this page paid the full computation
 * TWICE; grep history for `coverage=false` on `useScanRoots` if that ever
 * needs re-measuring.
 *
 * Two reads instead of one shared read, still deliberately:
 *
 * * The two panels are siblings on one page, each with its own Refresh, and
 *   `useRetainedRead` has no cross-hook cache to share. Lifting the read into
 *   the page would mean `ScanSourcesPanel` taking its data as a prop —
 *   changing a component with an open pull request against it (#1332) for a
 *   reason that has nothing to do with either change.
 * * Sharing one read would also share one Refresh, so re-asking "how much is
 *   missing" would silently re-ask "how far behind is each feeder" and vice
 *   versa. The panels state different things about different moments; one
 *   `fetchedAt` for both would make one of the two stamps a lie.
 *
 * The honest fix for the remaining extra round trip is an HTTP-layer cache or
 * a page-level provider, and neither is this phase's — both mean
 * `ScanSourcesPanel` taking its data as a prop, and that component has an
 * open pull request against it (#1332). If a third consumer of `/scan-roots`
 * ever appears, build that instead of adding a third read.
 *
 * `data` carries the WHOLE response — `coverage` plus the `coverage_detail`
 * that says why it is empty — because an empty `coverage` is not "nothing is
 * missing" and the panel cannot tell the difference without the detail.
 */
export function usePlanCoverage() {
  return useRetainedRead<ScanRootListResponse>(
    `${API}/scan-roots`,
    "Failed to load plan coverage"
  );
}
