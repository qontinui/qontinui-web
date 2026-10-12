"use client";

/**
 * /admin/coord/plan-library/artifacts — every captured artifact KIND.
 *
 * Plan `2026-09-19-plan-library-cannot-answer-what-to-work-on-next` folded the
 * plan-library browsing page into `/admin/coord/plans`, which reads
 * `kind = 'plan'` only. Prompts, findings reports, handoffs and the other
 * kinds the fleet captures into `agent.work_artifacts` would then have had no
 * browsable surface at all; this page is that surface — the all-kinds list
 * with its kind / status / repo facets and full-text search, opening each
 * document in place (`PlanLibraryList`).
 *
 * This store is a captured index, **not a backup**: nothing here restores a
 * file, and a document deleted on disk keeps its history here.
 *
 * R9: no page-level card and no `<h1>` — the coord layout owns both.
 */

import Link from "next/link";
import { Files } from "lucide-react";
import { PlanLibraryList } from "../_components/PlanLibraryList";

export default function PlanLibraryArtifactsPage() {
  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="plan-library-artifacts-page"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <Files
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden
        />
        <h2 className="text-sm font-semibold">Artifact library</h2>
        <p className="max-w-4xl text-xs text-muted-foreground">
          Every artifact kind the fleet captures — a searchable <em>index</em>,{" "}
          <strong>not a backup</strong>. Plans, reconciled against coord, are on{" "}
          <Link
            href="/admin/coord/plans"
            className="underline"
            data-testid="plan-library-artifacts-plans-link"
          >
            Plans
          </Link>
          ; the capture dials are on{" "}
          <Link
            href="/admin/coord/plan-library/settings"
            className="underline"
            data-testid="plan-library-artifacts-settings-link"
          >
            Plan library settings
          </Link>
          .
        </p>
      </div>

      <PlanLibraryList />
    </div>
  );
}
