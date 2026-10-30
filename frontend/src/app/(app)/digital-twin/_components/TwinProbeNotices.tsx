"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import { Provenance, usePresentationMode } from "@/components/presentation";
import { statusSuffix } from "../_lib/failure-text";
import {
  RESTRICTED_REASON,
  probeUnread,
  type ProbeAttempt,
  type ProbeRead,
} from "../_lib/probe-read";
import { upperFirst } from "../_lib/status-presentation";
import { FIDELITY_SOURCE, probeFedContent } from "../_lib/twin-aspects";
import { UnknownBadge } from "./FidelityFigures";

/**
 * The two notices every view of the sub-space probe shares (the Completeness
 * matrix and the Lifecycle view read the same probe, `useProbeRead`, so they
 * must degrade the same way).
 *
 * In presentation mode (plan `2026-10-23-console-presentation-spaces`) each is
 * a labelled UNKNOWN naming why there is no reading: an outsider must not read
 * an access decision as if it were data about the product, nor be shown a raw
 * transport error.
 */

/** A labelled UNKNOWN, for a reading the page does not have. */
export function UnknownReading({
  reason,
  consequence,
  children,
  "data-testid": testId,
}: {
  reason: string;
  /**
   * What the missing reading means for what is on screen, after "so": each
   * caller says it, because it is a claim about the view around the notice
   * — "no live status is shown here" holds only where the notice replaces
   * the view.
   */
  consequence: string;
  /** After the sentence: what dates it, when something does. */
  children?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-reading="unknown"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <UnknownBadge />
      <span className="text-muted-foreground">
        {upperFirst(reason)}, so {consequence}.
      </span>
      {children}
    </div>
  );
}

/**
 * coord's coarse twin tenant gate denied this operator (home tenant outside
 * the configured internal-tenant allowlist): EVERY probe was refused
 * (`resolve.ts` `allProbesRestricted`). Rendered INSTEAD of the view rather
 * than an all-"error" grid — it's an access decision, not an outage. A single
 * refused sub-space never reaches here; it renders as its own `restricted`
 * cell, so this copy stays true whenever it shows.
 */
export function TwinAccessRestricted() {
  const { presenting } = usePresentationMode();
  if (presenting) {
    return (
      <UnknownReading
        reason={RESTRICTED_REASON}
        // Rendered INSTEAD of the view: nothing live is on screen.
        consequence="no live status is shown here"
        data-testid="digital-twin-access-restricted"
      />
    );
  }
  return (
    <div
      data-testid="digital-twin-access-restricted"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center"
    >
      <Lock className="size-8 text-muted-foreground" />
      <h2 className="text-base font-semibold">Access restricted</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        The Digital Twin is limited to internal Qontinui operators. Your tenant
        isn&apos;t on the allowlist for the fleet-wide twin observers — ask an
        administrator if you need access.
      </p>
    </div>
  );
}

/** What the operator is told the live cells show, for each way the probe can fail. */
function operatorText(
  probe: Pick<ProbeRead, "failed" | "error" | "degraded" | "unanswered">
): string {
  if (probe.degraded !== null) {
    return `${upperFirst(probe.degraded)}. coord made no probe, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate.`;
  }
  // No read was answered, failed or is in flight: nothing reached coord, so
  // there is no transport error to quote.
  if (probe.unanswered !== null) {
    return `${upperFirst(probe.unanswered)}, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate.`;
  }
  const cause = `Could not reach the coordination layer${probe.error instanceof Error ? `: ${probe.error.message}` : ""}.`;
  return probe.failed
    ? `${cause} No probe has answered, so every live count and cell below is UNKNOWN; the taxonomy below is still accurate.`
    : `${cause} Live cells fall back to their last status; the taxonomy below is still accurate.`;
}

/**
 * The probe has no current reading — the request failed, it answered
 * degraded (HTTP 200 with no probe made), or react-query is holding its read
 * with nothing answered (`probeUnread`, the rule every view of the probe
 * applies) — or its last refresh failed over an earlier answer. Renders
 * nothing otherwise, so a view mounts it unconditionally.
 *
 * It sits ABOVE everything it qualifies — the live counts as well as the
 * cells — so "below" covers them all: the view still renders under it (the
 * manifest, UNKNOWN counts and cells, or the last answer's statuses), and the
 * notice says those are not a current reading rather than that nothing live
 * is shown.
 */
export function CoordUnreachableBanner({ probe }: { probe: ProbeAttempt }) {
  const { presenting } = usePresentationMode();
  const silence = probeUnread(probe);
  if (silence === null && !probe.refreshFailed) return null;
  if (presenting) {
    return (
      <UnknownReading
        reason={
          silence?.reason ??
          `coord's live probe could not be read${statusSuffix(probe.error)}`
        }
        consequence="the live statuses below are not a current reading"
        data-testid="digital-twin-coord-unreachable"
      />
    );
  }
  return (
    <div
      data-testid="digital-twin-coord-unreachable"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span>{operatorText(probe)}</span>
    </div>
  );
}

/**
 * The Twin map's notice for a probe answer kept after its latest read failed
 * (react-query keeps a query's data when a refetch fails: `refreshFailed`,
 * with a reading held, `probeUnread` null). The map's probe figures and its
 * live-probed part rows still show that answer, so they sit under this
 * notice. That is R6's row arm, the way the Completeness and Lifecycle cells
 * sit under {@link CoordUnreachableBanner}. The notice leads with the
 * failure, names what below is the last answer, dates that answer with a
 * `Provenance` chip in both modes, and says it is not a current reading. It
 * is worded for the map: the banner's "cells" and "taxonomy" are not on it.
 *
 * It names only the twins whose figures that answer decides (`twin-aspects.ts`
 * `probeFedContent`). Under coord's catalog those are the twins with a part
 * it declares: a twin with none shows its figures as UNKNOWN because nothing
 * in it is probed live, which the catalog says and the answer does not, so
 * calling them that answer would be false. With the catalog unread it is
 * every twin, since the manifest's `snapshot` rows and the answer's own cells
 * then say which parts are live-probed (`resolve.ts`). With no twin to name,
 * nothing on the map is the probe's answer, so there is no notice.
 *
 * A probe holding no reading at all needs no notice here: every probe figure
 * of a twin with a live-probed part is then UNKNOWN with the reason, and
 * every live part UNKNOWN with it (`twin-aspects.ts` `probeSilence`,
 * `resolve.ts`). Renders nothing otherwise, so the map mounts it
 * unconditionally. Both modes say the HTTP status only: the failure's own
 * text is the operator's, on the Completeness tab's banner.
 */
export function TwinMapHeldNotice({
  probe,
}: {
  probe: ProbeAttempt & Pick<ProbeRead, "rows" | "declared">;
}) {
  if (!probe.refreshFailed || probeUnread(probe) !== null) return null;
  const content = probeFedContent(probe.rows, probe.declared);
  if (content === null) return null;
  return (
    <UnknownReading
      reason={`coord's live probe's latest read failed${statusSuffix(probe.error)}`}
      consequence={`${content}, are its last answer, not a current reading`}
      data-testid="digital-twin-map-probe-held"
    >
      <Provenance
        source={FIDELITY_SOURCE.probe}
        asOf={probe.asOf}
        persistent
        data-testid="digital-twin-map-probe-held-provenance"
      />
    </UnknownReading>
  );
}
