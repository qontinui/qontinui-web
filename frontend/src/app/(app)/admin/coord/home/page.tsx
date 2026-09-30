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
 * It renders ONE coord read, `GET /api/v1/operations/project-state` (a plain
 * proxy of coord's `GET /coord/project-state`, the same shared core the
 * `coord_project_state` MCP tool serves), polled every 60 s. There is no
 * websocket, no toast and no notification of any kind: the profile asks for
 * "the right altitude, not the fastest feed". A failed poll keeps the last
 * good render and stamps it with its age.
 *
 * Every derivation is in `components/admin/coord/coordHomeStatus.ts`; the
 * regions are composed from console primitives in `_components/HomeSections`.
 * The answerability test this page is measured by is
 * `answerability.questions.json` beside this file.
 */

import { useMemo, useState } from "react";
import { useTenant } from "@/contexts/tenant-context";
import {
  NOTHING_READ,
  deriveHomeStrip,
} from "@/components/admin/coord/coordHomeStatus";
import { useProjectState } from "./_hooks/useProjectState";
import {
  CorrectSection,
  DegradingSection,
  DoesNotKnowSection,
  HomeStripSection,
  NeedsYouSection,
  OnTrackSection,
} from "./_components/HomeSections";

export default function CoordHomePage() {
  const { view, hasRead, stale, lastError, refresh } = useProjectState();
  const { tenants } = useTenant();
  const [correctOpen, setCorrectOpen] = useState(false);
  const strip = useMemo(() => deriveHomeStrip(view, { stale }), [view, stale]);
  const shown = view ?? NOTHING_READ;
  const tenantName =
    (view?.tenantId && tenants.find((t) => t.id === view.tenantId)?.name) ||
    null;

  return (
    // `overflow-x-auto`: a wide detail panel scrolls instead of stranding its
    // links off-screen. Vertical scroll comes from the coord layout's <main>.
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-home-page"
      data-ui-bridge-id="coord-home"
    >
      <HomeStripSection
        strip={strip}
        tenantName={tenantName}
        tenantId={view?.tenantId ?? null}
        stale={stale}
        generatedAt={view?.generatedAt ?? null}
        lastError={lastError}
        onRefresh={refresh}
      />
      {(!hasRead || !view) && (
        <p
          className="m-0 text-sm text-muted-foreground"
          data-testid="coord-home.unread"
        >
          {lastError
            ? `Coord's project state could not be read: ${lastError}. Every count on this page is a dash, not a zero.`
            : "Reading coord's project state…"}
        </p>
      )}
      <NeedsYouSection
        needs={shown.needsMe}
        stale={stale}
        generatedAt={shown.generatedAt}
      />
      <DegradingSection
        deg={shown.degradations}
        stale={stale}
        generatedAt={shown.generatedAt}
      />
      <OnTrackSection onTrack={shown.onTrack} />
      <CorrectSection
        correctness={shown.correctness}
        expanded={correctOpen}
        onToggle={() => setCorrectOpen((o) => !o)}
      />
      <DoesNotKnowSection sources={shown.doesNotKnow} />
    </div>
  );
}
