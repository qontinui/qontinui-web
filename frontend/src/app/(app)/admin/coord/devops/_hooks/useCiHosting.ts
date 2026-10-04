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
 * 3. **Out-of-order replies cannot paint an older value over a newer one** —
 *    each read takes a ticket and only the newest delivery is applied.
 *
 * `reload` resolves `true` when the read delivered, so a caller can retire a
 * state (a write's read-back failure) only on a CONFIRMED read.
 */
export function useCiHosting() {
  const [view, setView] = useState<CiHostingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notServed, setNotServed] = useState(false);
  const issued = useRef(0);
  const applied = useRef(0);

  const reload = useCallback(async (): Promise<boolean> => {
    const ticket = (issued.current += 1);
    setLoading(true);
    try {
      const next = await httpClient.get<CiHostingView>(CI_HOSTING_API);
      if (ticket < applied.current) return true;
      applied.current = ticket;
      setView(next);
      setError(null);
      setNotServed(false);
      return true;
    } catch (err) {
      if (ticket < applied.current) return false;
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
    /** A value is on screen, and the newest read failed to replace it. */
    stale: view !== null && error !== null,
    reload,
  };
}
