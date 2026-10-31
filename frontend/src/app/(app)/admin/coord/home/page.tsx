"use client";

/**
 * /admin/coord/home — the operator's one screen.
 *
 * Plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4. `audience_profile/human-operator` names *one-screen answerability*
 * — whether "what is the state of my projects, and what needs me" is
 * answerable from a single view without asking an agent — and this is that
 * view. `/admin/coord` redirects here.
 *
 * It renders coord's project state, `GET /api/v1/operations/project-state` (a
 * plain proxy of coord's `GET /coord/project-state`, the same shared core the
 * `coord_project_state` MCP tool serves), polled every 60 s — and, beside it,
 * coord's machine roster and (until coord serves `needs_me`) the Gates and
 * Questions pages' queue reads (`_hooks/useHomeSupplements.ts`), on the same
 * cadence, each labelled with its own source. There is no
 * websocket, no toast and no notification of any kind: the profile asks for
 * "the right altitude, not the fastest feed". A failed poll keeps the last
 * good render and stamps it with its age.
 *
 * Every derivation is in `components/admin/coord/coordHomeStatus.ts`; the
 * regions are composed from console primitives in `_components/HomeSections`.
 * The answerability test this page is measured by is
 * `answerability.questions.json` beside this file.
 *
 * ## Presentation mode (plan `2026-10-23-console-presentation-spaces` Phase 2)
 *
 * The coordination overview is lens surface 2 (`lensSurfaces.ts`), and it is
 * registered presentation-ready (`presentationReadiness.ts`) on the strength
 * of `page.presentation.test.tsx`. The same route and the same read, rendered
 * for an external evaluator (D1): the page opens with its caption, each
 * region with its caption and the provenance of its figures (the one read,
 * dated by coord's answer), a kept reading after a failed refresh is named as
 * the last one and never as current, free text is redacted, machines are
 * aliased, raw ids and coord's quoted errors are not rendered — a failed read
 * is explained in the page's own fixed words where its reason allows, and
 * withheld otherwise — and answering a decision is the operator's alone.
 * Nothing new is fetched. Style guide §3.14 records it; in operator mode the
 * page is unchanged.
 */

import { useCallback, useMemo, useState } from "react";
import { useTenant } from "@/contexts/tenant-context";
import { Caption, usePresentationMode } from "@/components/presentation";
import {
  NOTHING_READ,
  deriveHomeStrip,
} from "@/components/admin/coord/coordHomeStatus";
import { useProjectState } from "./_hooks/useProjectState";
import { useHomeSupplements } from "./_hooks/useHomeSupplements";
import { presentedHomeFailure } from "./_lib/homeLens";
import { KeptReadingNotice } from "./_components/HomeLens";
import {
  CorrectSection,
  DegradingSection,
  DoesNotKnowSection,
  HomeStripSection,
  NeedsYouSection,
  OnTrackSection,
} from "./_components/HomeSections";

export default function CoordHomePage() {
  const { view, hasRead, stale, lastError, presentableError, refresh } =
    useProjectState();
  const { tenants } = useTenant();
  const { presenting } = usePresentationMode();
  const [correctOpen, setCorrectOpen] = useState(false);
  const shown = view ?? NOTHING_READ;
  // Beside the one project-state read: coord's machine roster (the source the
  // nav's Dev Ops badge counts), and — until coord serves `needs_me` — the
  // queue counts the Gates and Questions pages read (`_lib/homeSupplements`).
  const supplements = useHomeSupplements({
    needsQueues: shown.needsMe.state !== "read",
  });
  const { machines } = supplements;
  const stripMachines = useMemo(
    () =>
      machines.state === "read" && machines.counts !== null
        ? {
            stale: machines.stale,
            notHealthy: machines.counts.notHealthy,
            noState: machines.counts.noState,
          }
        : null,
    [machines.state, machines.counts, machines.stale]
  );
  const strip = useMemo(
    () => deriveHomeStrip(view, { stale, machines: stripMachines }),
    [view, stale, stripMachines]
  );
  const refreshSupplements = supplements.refresh;
  // The one refresh re-reads everything the page shows.
  const refreshAll = useCallback(
    () => Promise.all([refresh(), refreshSupplements()]).then(() => undefined),
    [refresh, refreshSupplements]
  );
  const tenantName =
    (view?.tenantId && tenants.find((t) => t.id === view.tenantId)?.name) ||
    null;
  // Every region renders the one answer on screen: coord's `generated_at`
  // dates it, and a kept one says so.
  const generatedAt = shown.generatedAt;
  const reading = { generatedAt, kept: stale };
  // The latest failure as this mode may show it: the operator's own words;
  // while presenting, the page's fixed words for it, or withheld when only
  // outside words can tell it. One decision, for every line that says it.
  const failure = presentedHomeFailure(lastError, presentableError, presenting);

  return (
    // `overflow-x-auto`: a wide detail panel scrolls instead of stranding its
    // links off-screen. Vertical scroll comes from the coord layout's <main>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-home-page"
      data-ui-bridge-id="coord-home"
    >
      {/* Presentation mode only (D1, "captions before data"): what this page
          shows and why it matters, ahead of the strip; then, after a failed
          refresh, that what follows is the last reading. Operator mode
          renders neither, so R1's "the page opens with its health strip"
          holds for the operator. */}
      <Caption id="coordination-overview.page" />
      <KeptReadingNotice reading={reading} failure={failure} />
      <HomeStripSection
        strip={strip}
        tenantName={tenantName}
        tenantId={view?.tenantId ?? null}
        stale={stale}
        generatedAt={view?.generatedAt ?? null}
        failure={failure}
        onRefresh={refreshAll}
      />
      {(!hasRead || !view) && (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-home.unread"
        >
          {lastError
            ? `Coord's project state could not be read: ${failure}. Every count on this page is a dash, not a zero.`
            : "Reading coord's project state…"}
        </p>
      )}
      <NeedsYouSection
        needs={shown.needsMe}
        gates={supplements.gates}
        questions={supplements.questions}
        stale={stale}
        generatedAt={generatedAt}
      />
      <DegradingSection
        deg={shown.degradations}
        machines={machines}
        sources={shown.doesNotKnow}
        stale={stale}
        generatedAt={generatedAt}
      />
      <OnTrackSection
        onTrack={shown.onTrack}
        stale={stale}
        generatedAt={generatedAt}
      />
      <CorrectSection
        correctness={shown.correctness}
        expanded={correctOpen}
        onToggle={() => setCorrectOpen((o) => !o)}
        stale={stale}
        generatedAt={generatedAt}
      />
      <DoesNotKnowSection
        sources={shown.doesNotKnow}
        planes={shown.degradations.planes}
        stale={stale}
        generatedAt={generatedAt}
      />
    </div>
  );
}
