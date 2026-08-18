"use client";

/**
 * /admin/coord/prompt-documents — tenant-scoped editor for every prompt-shaped
 * document coord serves the fleet (plan
 * `2026-07-17-session-autonomy-fabric.md`, Phase 9).
 *
 * One editor over all four kinds — `policy` (the canonical prose the agent Q&A
 * meta-answer composes in via `{{policy:<name>}}`), `response_prompt` (the
 * meta-answer template itself), `continuation_rules` (the Stop-hook umbrella
 * prompt), and `agent_playbook` (e.g. the merge-shepherd playbook) — replacing
 * the kind-specific `/admin/coord/policy-documents` page it supersedes. Coord
 * seeds each document, versions every edit, and serves it per tenant.
 *
 * Reads are visible to any tenant member; edits + restore are re-checked as
 * tenant-admin by coord.
 *
 * The page also carries the **session compliance** surface (plan
 * `2026-07-30-session-compliance-report-enforcement.md` §B): the switch for the
 * check that holds closing sessions to the POLICY_COMPLIANCE report their
 * policy requires, the per-session verdicts, and the outstanding-work ledger.
 * It lives here — not behind its own nav entry — because what it enforces is
 * one of the documents listed above.
 *
 * Crawl-safety: a child of the `/admin/coord` layout, which gates the subtree on
 * `user?.is_superuser` and renders `null` otherwise — so the Spec-CI crawl (no
 * authenticated user) never mounts the body. Talks only to the always-registered
 * `httpClient` (no cloud-only extension slot), matching every sibling
 * admin/coord page.
 */

import { NotebookText } from "lucide-react";
import { PolicyWriteDialControl } from "./_components/PolicyWriteDialControl";
import { PromptDocumentList } from "./_components/PromptDocumentList";
import { SessionComplianceSection } from "./_components/SessionComplianceSection";

export default function PromptDocumentsPage() {
  return (
    <div className="space-y-8 p-6" data-testid="prompt-documents-page">
      <div className="flex items-start gap-3">
        <NotebookText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Prompt Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The prompt-shaped content coord serves your fleet: policy prose,
            response templates, continuation rules, and agent playbooks. Every
            edit is saved as a new version — prior wordings stay readable and
            restorable, and seeded documents can be reset to their shipped
            default.
          </p>
        </div>
      </div>

      <PromptDocumentList />

      {/*
        The tenant-wide autonomy dial sits with the per-document write-access
        control it composes with. Two controls governing one question — "what
        may an agent do to this policy?" — belong on one page; the per-document
        setting decides WHETHER, this decides HOW MUCH, and the answer is the
        more restrictive of the two. Coord's own refusal message sends operators
        to this page for the first, so the second must be here too.
      */}
      <div className="border-t border-border pt-8">
        <PolicyWriteDialControl />
      </div>

      {/*
        Session compliance lives on this page rather than behind its own nav
        entry: the thing it enforces is one of the documents above, and the
        clause it names is edited a few inches away. Splitting the switch from
        the text it enforces is exactly how the two drift apart.
      */}
      <div className="border-t border-border pt-8">
        <SessionComplianceSection />
      </div>
    </div>
  );
}
