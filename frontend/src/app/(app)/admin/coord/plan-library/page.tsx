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
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * This route landed after the console plan was authored and was missing from
 * its census (§4 correction), which files it as the closest of the five to
 * conformant: already row-shaped, but with its detail behind a MODAL. The
 * conversion to expand-in-place, and the one trap in it, are documented in
 * `_components/PlanLibraryList.tsx`.
 *
 * **R9** here is the page body — `p-3 sm:p-6 space-y-4`, was `space-y-6 p-6`
 * — and the header, which was a heading stacked over a five-line paragraph.
 * The console shell already renders the title bar, so the `<h1>` was a second
 * title. The paragraph is cut to the sentence that changes a decision — this
 * is an INDEX, not a backup — because that is the one an operator must not
 * miss, and the module doc above is where the rest belongs.
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
    <div className="p-3 sm:p-6 space-y-4" data-testid="plan-library-page">
      <div className="flex flex-wrap items-baseline gap-2">
        <Library
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden
        />
        {/* `<h2>`, not `<h1>` — `admin/coord/layout.tsx` already renders the
            console's one `<h1>` ("Coord operator console"), which 13 Playwright
            assertions match by role and exact name. A second `<h1>` was always
            a document-outline defect; R9 restyling this one to `text-sm` made
            it a VISUAL duplicate of the shell title as well, which is what
            turned a latent nit into a real one. All seven Wave 3 routes render
            no page heading at all; this stays because it names a surface the
            nav crumb abbreviates. Pixel-identical either way. */}
        <h2 className="text-sm font-semibold">Plan &amp; Prompt Library</h2>
        <p className="max-w-4xl text-xs text-muted-foreground">
          A searchable <em>index</em> of the prompts, findings reports,
          handoffs and plans the fleet produces — <strong>not a backup</strong>:
          nothing here restores a file, and a document deleted on disk keeps its
          history here.
        </p>
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
