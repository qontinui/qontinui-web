"use client";

/**
 * /admin/coord/policy-documents — tenant-scoped editor for the canonical policy
 * prose the agent Q&A meta-answer composes in (plan: agent Q&A single
 * decision-delegation meta-answer, Phase 1 + Phase 5 UI).
 *
 * Each document (Engineering Priorities, Operating Rules, Escalation Bar, …) is
 * coord-seeded and referenced by the meta-answer template as
 * `{{policy:<handle>}}`; coord expands the token to the document body per tenant
 * at answer time. Reads are visible to any tenant member; edits + restore are
 * re-checked as tenant-admin by coord.
 *
 * Crawl-safety: a child of the `/admin/coord` layout, which gates the subtree on
 * `user?.is_superuser` and renders `null` otherwise — so the Spec-CI crawl (no
 * authenticated user) never mounts the body. Talks only to the always-registered
 * `httpClient` (no cloud-only extension slot), matching every sibling
 * admin/coord page.
 */

import { NotebookText } from "lucide-react";
import { PolicyDocumentList } from "./_components/PolicyDocumentList";

export default function PolicyDocumentsPage() {
  return (
    <div className="space-y-6 p-6" data-testid="policy-documents-page">
      <div className="flex items-start gap-3">
        <NotebookText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h1 className="text-lg font-semibold">Policy Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The canonical policy prose the agent decision-delegation meta-answer
            composes in. Each document is referenced from the meta-answer
            template as <code>{"{{policy:<handle>}}"}</code> and expanded per
            tenant when coord answers an agent question.
          </p>
        </div>
      </div>

      <PolicyDocumentList />
    </div>
  );
}
