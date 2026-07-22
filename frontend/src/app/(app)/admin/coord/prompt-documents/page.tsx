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
 * Crawl-safety: a child of the `/admin/coord` layout, which gates the subtree on
 * `user?.is_superuser` and renders `null` otherwise — so the Spec-CI crawl (no
 * authenticated user) never mounts the body. Talks only to the always-registered
 * `httpClient` (no cloud-only extension slot), matching every sibling
 * admin/coord page.
 */

import { NotebookText } from "lucide-react";
import { PromptDocumentList } from "./_components/PromptDocumentList";

export default function PromptDocumentsPage() {
  return (
    <div className="space-y-6 p-6" data-testid="prompt-documents-page">
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
    </div>
  );
}
