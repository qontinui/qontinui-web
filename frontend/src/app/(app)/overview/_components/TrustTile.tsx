"use client";

/**
 * The "Can I trust 'done'?" section of the Summary's side column: the two
 * reads (`useVerificationMetrics`) folded into `TrustPanel`'s model.
 */

import { useMemo } from "react";
import { useVerificationMetrics } from "@/components/admin/coord/useVerificationMetrics";
import {
  deriveTrustView,
  refutedUnitsInWindow,
} from "@/components/admin/coord/verificationMetrics";
import { TrustPanel, type RefutedList } from "./TrustPanel";

export function TrustTile({
  tenantId,
  hold,
}: {
  tenantId: string | null;
  hold: boolean;
}) {
  const { read, refuted, lastGood } = useVerificationMetrics(tenantId, hold);
  const view = useMemo(() => deriveTrustView(read, lastGood), [read, lastGood]);

  const windowFrom =
    view.state === "populated" || view.state === "no_verifications"
      ? view.windowFrom
      : null;
  const list: RefutedList = useMemo(() => {
    if (refuted.status !== "ok") return refuted;
    return {
      status: "ok",
      units: windowFrom
        ? refutedUnitsInWindow(refuted.findings, windowFrom)
        : [],
      truncated: refuted.truncated,
    };
  }, [refuted, windowFrom]);

  return (
    <section
      aria-labelledby="overview-trust-heading"
      aria-busy={view.state === "loading"}
      className="mt-12"
    >
      <h2
        id="overview-trust-heading"
        className="mb-5 font-[family-name:var(--font-overview-serif)] text-[1.625rem] leading-snug text-foreground"
      >
        Can I trust &lsquo;done&rsquo;?
      </h2>
      <TrustPanel view={view} refuted={list} />
    </section>
  );
}
