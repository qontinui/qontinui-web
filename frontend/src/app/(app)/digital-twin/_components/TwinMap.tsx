"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER } from "@/components/console";
import {
  Caption,
  Provenance,
  usePresentationMode,
} from "@/components/presentation";
import { cn } from "@/lib/utils";
import { useAppTwin } from "../_hooks/useAppTwin";
import { useProbeRead } from "../_hooks/useProbeRead";
import { useSubspaceRaw } from "../_hooks/useSubspaceRaw";
import { useTwinWorkUnits } from "../_hooks/useTwinWorkUnits";
import {
  TWIN_ASPECTS,
  appTwinFidelity,
  aspectRows,
  plantFidelity,
  twinAspect,
  type TwinAspectId,
} from "../_lib/twin-aspects";
import { FIDELITY_SUBSPACE } from "../_lib/twin-fidelity";
import {
  planReadOf,
  plansForSubspaces,
  type TwinPlanRead,
} from "../_lib/twin-plans";
import { AspectCard, PLAN_SOURCE } from "./AspectCard";
import { AspectDetail } from "./AspectDetail";
import { FIGURE_UNKNOWN } from "./FidelityFigures";
import { TwinMapHeldNotice } from "./TwinProbeNotices";

/** What the plans on this tab were read from, and whether that read is whole. */
function PlanReadLine({ read }: { read: TwinPlanRead }) {
  if (read.kind === "loading") {
    return (
      <p className="text-xs text-muted-foreground">
        Reading the work units that carry the plans…
      </p>
    );
  }
  if (read.kind === "error") {
    return (
      <div
        data-testid="digital-twin-plans-unknown"
        className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Badge
          variant="outline"
          className={cn("text-[11px] font-semibold", UNKNOWN_AMBER)}
        >
          {FIGURE_UNKNOWN}
        </Badge>
        <span>The plans could not be read: {read.reason}</span>
        <Provenance source={PLAN_SOURCE} asOf={read.at} />
      </div>
    );
  }
  return (
    <div
      data-testid="digital-twin-plans-read"
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>
        Plans come from{" "}
        {read.units === 1 ? "1 work unit" : `${read.units} work units`} read
        from coord.
      </span>
      {read.incomplete && (
        <Badge
          variant="outline"
          data-testid="digital-twin-plans-incomplete"
          className={cn("text-[11px] font-semibold", UNKNOWN_AMBER)}
          title={`The plan counts cover only the work units read: ${read.incomplete}.`}
        >
          INCOMPLETE — {read.incomplete}
        </Badge>
      )}
      {read.refreshError && (
        <span data-testid="digital-twin-plans-stale">
          The last refresh failed ({read.refreshError}); these are the plans
          from the read before it.
        </span>
      )}
      <Provenance source={PLAN_SOURCE} asOf={read.asOf} />
    </div>
  );
}

/**
 * The Twin map — the digital twin's landing view (plan
 * `2026-10-23-console-presentation-spaces` Phase 5). One card per aspect of
 * the twin — the environment, process and intent twins and the UI Bridge app
 * twin — with its fidelity and the plans moving it; a card opens the aspect's
 * parts and plans below the cards.
 *
 * Every read here is one the page already makes (D1): the probe, coord's
 * catalog and the twin self-check the Completeness tab reads, the UI Bridge
 * tab's runner reads, and the work-unit list `/admin/coord/work-units` walks.
 * The engineering detail behind each number stays one tab away.
 *
 * A probe answer kept after its latest read failed still feeds the figures
 * and part rows, so the map's own notice leads above them and names them as
 * that last answer (`TwinMapHeldNotice`, style guide R6 and 6.5). It names
 * only the twins the probe feeds, those with a live-probed part.
 */
export function TwinMap() {
  // The probe as every view of it reads it: a failed or degraded answer
  // (HTTP 200, no probe made) is UNKNOWN on every figure, never "0 of N
  // observed", and its parts are UNKNOWN in the drill-down, never "Error".
  const probe = useProbeRead();
  const { rows } = probe;
  const reportQuery = useSubspaceRaw(FIDELITY_SUBSPACE, true);
  const plansQuery = useTwinWorkUnits();
  const appTwin = useAppTwin();
  const { presenting } = usePresentationMode();
  const [open, setOpen] = useState<TwinAspectId | null>(null);

  // Worded for the mode: while presenting, a failure is a fixed phrase and
  // its HTTP status, never the response body (D3.3).
  const read = planReadOf(plansQuery, { presenting });
  const now = Date.now();

  return (
    <section data-testid="digital-twin-twin-map" className="space-y-4">
      <Caption id="digital-twin.twin-map" level={2} persistent />
      <TwinMapHeldNotice probe={probe} />
      <PlanReadLine read={read} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {TWIN_ASPECTS.map((aspect) => {
          const parts = aspectRows(aspect, rows);
          const figures =
            aspect.figuresFrom === "runner"
              ? appTwinFidelity(appTwin)
              : plantFidelity(parts, probe, reportQuery, now);
          return (
            <AspectCard
              key={aspect.id}
              aspect={aspect}
              figures={figures}
              read={read}
              plans={
                read.kind === "ready"
                  ? plansForSubspaces(parts, read.index)
                  : null
              }
              open={open === aspect.id}
              onToggle={() =>
                setOpen((current) => (current === aspect.id ? null : aspect.id))
              }
            />
          );
        })}
      </div>

      {open && (
        <AspectDetail
          // Keyed by aspect, so a different aspect opens unfiltered.
          key={open}
          aspect={twinAspect(open)}
          rows={aspectRows(twinAspect(open), rows)}
          read={read}
        />
      )}
    </section>
  );
}
