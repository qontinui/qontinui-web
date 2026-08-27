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
 */

import { Gavel } from "lucide-react";
import { ReviewFeed } from "./_components/ReviewFeed";

export default function PromptDocumentProposalsPage() {
  return (
    <div className="space-y-6 p-6" data-testid="prompt-document-proposals-page">
      <div className="flex items-start gap-3">
        {/* Same icon as this page's nav entry (CoordNav `Gavel`) — the two are
            the same destination and must look like it. */}
        <Gavel
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div>
          <h1 className="text-lg font-semibold">Policy Edit Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edits your agents proposed to the policies coord serves them.
            Anything that would widen what agents may do on their own is held
            here for you rather than applied; everything else lands immediately
            and is listed below, undoable in one click. Nothing is waiting on
            you to keep working — an unreviewed proposal simply hasn&apos;t been
            applied.
          </p>
        </div>
      </div>

      <ReviewFeed />
    </div>
  );
}
