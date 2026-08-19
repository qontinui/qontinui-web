"use client";

import { useEffect, useState } from "react";
import { isGateClearanceRow } from "../gate-clearance/gateClearance";
import type { CoordPolicyRow } from "./coordPolicies";
import { listCoordPolicies } from "./coordPolicyApi";

/**
 * Read-only, fail-SILENT fetch of the workspace's `gate_clearance` rules, for
 * surfaces that only want to NAME a rule (the gates table's provenance
 * sub-line), not to author one.
 *
 * Returns `null` until loaded and `null` again on any failure — never `[]`. The
 * distinction is load-bearing: an empty array is a CLAIM ("this workspace has
 * no clearance rules, so any rule id you hold is stale"), while `null` is the
 * absence of information, and callers render no band at all for it. Failures
 * are silent by design — this
 * is a decoration on a page whose primary data is the gate list, and a toast
 * for it would be noise on an unrelated outage.
 */
export function useClearanceRuleSet(): readonly CoordPolicyRow[] | null {
  const [rules, setRules] = useState<readonly CoordPolicyRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCoordPolicies()
      .then((res) => {
        if (cancelled) return;
        setRules((res.policies ?? []).filter(isGateClearanceRow));
      })
      .catch(() => {
        if (!cancelled) setRules(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return rules;
}
