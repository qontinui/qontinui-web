"use client";

/**
 * What this read of `/plan-library/reconciliation` did and did not measure.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 2, and
 * its general rule, which is the reason this block exists rather than a
 * footnote: **render the population state before any flag derived from the
 * population.**
 *
 * The ORDER of the lines is the contract, and it is computed — not authored
 * here — by `planReconciliationStatus.ts` `deriveDisclosure`, which also decides
 * whether the document-completeness claim may be published at all. On a read
 * where coord's work-unit population arm failed, that claim is vacuously true
 * (Phase 0, Finding 2: the degraded read is the MORE optimistic one) and the
 * deriver suppresses it.
 *
 * Phase 4c moved the rendering itself into `<DisclosureLinesPanel>`, shared with
 * `/admin/coord/plan-candidates`, which owes the operator the same three
 * disclosures over a different route. This file is now the reconciliation
 * page's testid prefix and nothing else — `coord-plans-disclosure-*`, which
 * the Phase 2 tests address by name.
 */

import { DisclosureLinesPanel } from "./DisclosureLinesPanel";
import type { DisclosureLine } from "./disclosureLines";

export function ReconciliationDisclosure({
  lines,
}: {
  lines: readonly DisclosureLine[];
}) {
  return (
    <DisclosureLinesPanel lines={lines} testIdPrefix="coord-plans-disclosure" />
  );
}
