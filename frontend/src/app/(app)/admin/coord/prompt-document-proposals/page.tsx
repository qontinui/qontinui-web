"use client";

/**
 * /admin/coord/prompt-document-proposals — operator review feed for
 * agent-authored policy edits (plan
 * `2026-07-28-migrate-claude-md-into-qontinui.md`, Phase 5).
 *
 * coord lets agents edit the policy documents it serves the fleet. Its write
 * path classifies each edit's DIRECTION against the autonomy-tier ordering
 * (`never` > `ask-first` > `proceed+notify` > `proceed+log` > `proceed`).
 * Additive and tier-raising edits land immediately; an edit that lowers a tier
 * or widens authority — or that the comparator cannot classify, which counts as
 * loosening — is held as a pending proposal instead. This page is where those
 * are read and decided, alongside the writes that did land (each undoable).
 *
 * ASYNC BY DESIGN. It is a review QUEUE, not a gate: no agent, session, or merge
 * waits on it. A proposal sitting here means the edit did not happen, which is
 * the safe state — so an unread queue costs correctness nothing.
 *
 * Auth: a child of the `/admin/coord` layout, so any authenticated tenant member
 * may READ it; approve / reject / undo are wrapped in `CoordAdminOnly`, and the
 * backend proxy + coord both re-check tenant-admin. The deciding identity is
 * stamped server-side from the web session — never taken from the browser.
 *
 * Talks only to the always-registered `httpClient` under `/api/v1/operations`
 * (no cloud-only extension slot), matching every sibling admin/coord page.
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * This route landed after the console plan was authored and was missing from
 * its census (§4 correction, where it is the Family-B **variant**). Migrated
 * per `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the body is `p-3 sm:p-6 space-y-4` (was `space-y-6 p-6`) and the
 *   page header is one line rather than a stacked heading-plus-paragraph. The
 *   console shell already renders the title bar, so the `<h1>` here was a
 *   second title; the paragraph survives beside it because it says the thing
 *   an operator needs to know before deciding anything — that nothing is
 *   waiting on them.
 * - **R2/R5/R3** — in `_components/ProposalCard.tsx` and
 *   `proposalStatus.ts`; see those files for the fat-card removal and the
 *   palette correction.
 */

import { Gavel } from "lucide-react";
import { ReviewFeed } from "./_components/ReviewFeed";

export default function PromptDocumentProposalsPage() {
  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="prompt-document-proposals-page"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        {/* Same icon as this page's nav entry (CoordNav `Gavel`) — the two are
            the same destination and must look like it. */}
        <Gavel
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
        <h2 className="text-sm font-semibold">Policy Edit Review</h2>
        <p className="text-xs text-muted-foreground">
          Edits your agents proposed to the policies coord serves them. Anything
          that would widen what agents may do on their own is held here for you
          rather than applied; everything else lands immediately and is listed
          below, undoable in one click. Nothing is waiting on you to keep
          working — an unreviewed proposal simply hasn&apos;t been applied.
        </p>
      </div>

      <ReviewFeed />
    </div>
  );
}
