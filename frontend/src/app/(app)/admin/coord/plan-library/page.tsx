"use client";

/**
 * /admin/coord/plan-library — the operator surface over the Plan & Prompt
 * Library (`agent.work_artifacts`), Phase 5 of
 * `2026-08-10-plan-and-prompt-library-in-web`.
 *
 * A sibling of `admin/coord/plans` (coord's work units) and
 * `admin/coord/prompt-documents` (the prose coord serves the fleet). What is
 * NEW here is the corpus itself: the plans, prompts, findings reports and
 * handoffs the fleet writes to disk, captured into a web-owned store so they
 * are queryable, versioned and linkable instead of living only as markdown in
 * a dozen checkouts.
 *
 * Four sections, in the order an operator uses them:
 *
 * 1. **Plan capture** — the `plan_capture` fleet-policy toggle, first-class at
 *    the top because it is the one control on this page that changes what the
 *    fleet does. It shows the value devices RESOLVE, not the value last
 *    written.
 * 2. **Capture health** — which door is feeding the store, so "the agent door
 *    is unused" is visible rather than inferred.
 * 3. **The corpus** — filter, search, and open one artifact in full.
 * 4. **Divergent copies** — where the library holds two versions that
 *    disagree, on content or on kind.
 *
 * This store is a captured index, **not a backup**. The scan mirrors what is
 * on disk; deleting a file does not delete history here, and nothing here
 * restores a file. That is stated on the page, not just in the plan, because
 * an operator who mistakes it for a backup will make an irreversible decision
 * on a false premise.
 *
 * Authz: the `/admin/coord` layout does **not** admin-gate — any authenticated
 * tenant member may VIEW these pages, and its own header says not to restate
 * it as "admin-gated" (`admin/coord/layout.tsx`). Reads here are therefore
 * member-visible and tenant-scoped server-side; the one MUTATING control (the
 * capture toggle) is gated by coord-tenant admin on the backend
 * (`require_coord_tenant_admin`) and merely *reflected* in the UI via
 * `can_edit`. The kind correction is likewise gated by the backend's own
 * org scoping. Talks only to the always-registered `httpClient`, matching
 * every sibling admin/coord page.
 */

import { useState } from "react";
import { Library } from "lucide-react";
import { CapturePolicyPanel } from "./_components/CapturePolicyPanel";
import { CaptureHealthPanel } from "./_components/CaptureHealthPanel";
import { DivergencePanel } from "./_components/DivergencePanel";
import {
  PlanLibraryList,
  type OpenArtifactRequest,
} from "./_components/PlanLibraryList";

export default function PlanLibraryPage() {
  // The divergence panel and the list share ONE detail dialog (it lives in the
  // list, which owns the write that a kind correction has to refresh). This is
  // the request channel between them.
  const [openRequest, setOpenRequest] = useState<OpenArtifactRequest | null>(
    null
  );

  return (
    <div className="space-y-6 p-3 sm:p-6" data-testid="plan-library-page">
      <div className="flex items-start gap-3">
        <Library className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Plan &amp; Prompt Library</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            The investigation prompts, plan-authoring prompts, implementation
            prompts, findings reports, handoffs and plans the fleet produces —
            captured, versioned, and linked to what produced them. This is a
            searchable <em>index</em> of that work, not a backup of it: nothing
            here restores a file, and a document deleted on disk keeps its
            history here.
          </p>
        </div>
      </div>

      <CapturePolicyPanel />
      <CaptureHealthPanel />
      <PlanLibraryList openRequest={openRequest} />
      <DivergencePanel
        onOpenArtifact={(id) =>
          setOpenRequest((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }))
        }
      />
    </div>
  );
}
