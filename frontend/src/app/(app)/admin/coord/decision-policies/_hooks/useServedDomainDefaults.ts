"use client";

import { useEffect, useState } from "react";
import { fetchNextStepSettings } from "@/lib/api/operations/coordSettings";
import type { ServedDomainDefault } from "../decisionPolicies";

export interface ServedDomainDefaults {
  /** `null` until a read has succeeded. */
  domains: readonly ServedDomainDefault[] | null;
  /** The last read's failure, or `null`. A failure is UNKNOWN, not "no row". */
  error: string | null;
}

/**
 * Coord's served per-domain defaults (`default_autonomy_level` +
 * `default_source`) from `GET /coord/next-step-settings`, re-read every time
 * `active` turns true — the create dialog opening — so the override warning
 * reflects the system row as coord last resolved it (coord caches for up to
 * ~30s), not as it was when the page loaded.
 *
 * Deliberately not `settings/coordination`'s `useNextStepSettings`: that hook
 * carries a save draft and toasts its own load failure, and here a failed read
 * is shown inline, in the form, as an UNKNOWN caution.
 */
export function useServedDomainDefaults(active: boolean): ServedDomainDefaults {
  const [domains, setDomains] = useState<readonly ServedDomainDefault[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setDomains(null);
    setError(null);
    fetchNextStepSettings()
      .then((settings) => {
        if (cancelled) return;
        if (!Array.isArray(settings?.domains)) {
          setError("coord's settings response carried no domains list");
          return;
        }
        setDomains(settings.domains);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { domains, error };
}
