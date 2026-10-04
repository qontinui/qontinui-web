"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isNotFoundError } from "@/components/console";
import { httpClient } from "@/services/service-factory";
import { CI_HOSTING_API, type CiHostingView } from "../_lib/hostedCiStatus";

/** What the panel says when the read route is not there to answer. */
export const CI_HOSTING_NOT_SERVED =
  "this coord build does not serve the hosted-CI read yet";

function message(err: unknown): string {
  return err instanceof Error ? err.message : "the hosted-CI read failed";
}

/**
 * The GitHub-hosted CI read — tenant default plus one reading per repo.
 *
 * Three honesty properties (plan
 * `2026-10-04-github-hosted-ci-is-a-per-tenant-dev-ops-setting` D5/D7):
 *
 * 1. **A failed LATEST read keeps the last values, labelled stale** — never
 *    blanked (blank would read as "no repos") and never re-confirmed. `stale`
 *    is true exactly when a value is on screen and the newest read did not
 *    replace it.
 * 2. **A 404 is UNKNOWN, not a value.** An older coord (or web backend) has no
 *    such route; `notServed` says so, and nothing renders a level from it.
 * 3. **Out-of-order replies cannot paint an older answer over a newer one** —
 *    each read takes a ticket, and a reply is applied only when no NEWER read
 *    has already settled, success or failure alike. So an older success that
 *    lands after a newer failure neither replaces the value nor clears the
 *    error: the newest thing known is that the latest read failed.
 *
 * `reload` resolves `true` only when THIS read delivered and was applied, so
 * a caller can retire a state (a write's read-back failure) only on a
 * CONFIRMED read. `deliveries` counts applied reads, so a caller can ask
 * "has a read landed since X?" — the tenant row's write-vs-aggregate check.
 */
export function useCiHosting() {
  const [view, setView] = useState<CiHostingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notServed, setNotServed] = useState(false);
  const [deliveries, setDeliveries] = useState(0);
  const issued = useRef(0);
  /** The newest ticket that has SETTLED (delivered or failed). */
  const settled = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const ticket = (issued.current += 1);
    setLoading(true);
    try {
      const next = await httpClient.get<CiHostingView>(CI_HOSTING_API);
      if (ticket < settled.current) return false;
      settled.current = ticket;
      setView(next);
      setError(null);
      setNotServed(false);
      setDeliveries((n) => n + 1);
      return true;
    } catch (err) {
      if (ticket < settled.current) return false;
      settled.current = ticket;
      if (isNotFoundError(err)) {
        setNotServed(true);
        setError(CI_HOSTING_NOT_SERVED);
      } else {
        setNotServed(false);
        setError(message(err));
      }
      return false;
    } finally {
      if (ticket === issued.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    view,
    loading,
    error,
    notServed,
    /** How many reads have been applied — "has a read landed since X?". */
    deliveries,
    /** A value is on screen, and the newest read failed to replace it. */
    stale: view !== null && error !== null,
    reload,
  };
}
