"use client";

/**
 * /admin/coord/prompt-documents — tenant-scoped editor for every prompt-shaped
 * document coord serves the fleet (plan
 * `2026-07-17-session-autonomy-fabric.md`, Phase 9).
 *
 * One editor over all thirteen kinds, grouped into two bands (see
 * `PromptDocumentList`), replacing the kind-specific
 * `/admin/coord/policy-documents` page it supersedes. Coord seeds each
 * document, versions every edit, and serves it per tenant.
 *
 * **Behavior** — how a session must act: `session_briefing` (the text appended
 * to the system prompt of every session the runner hosts), `claude_settings`
 * (the fleet's Claude Code settings baseline a machine renders into its own
 * `.claude/settings.json`), `policy` (the canonical prose the agent Q&A
 * meta-answer composes in via `{{policy:<name>}}`), `response_prompt` (the
 * meta-answer template itself), `continuation_rules` (the Stop-hook umbrella
 * prompt), `agent_playbook` (e.g. the merge-shepherd playbook), and
 * `prompt_template` (the runner terminal `/prompt` library).
 *
 * **Intent** — what the tenant is building, for whom, and what "better" means
 * (plan `2026-08-21-project-intent-documents-and-the-selection-loop`):
 * `product_intent`, `initiative`, `success_metric`, `domain_spec`,
 * `audience_profile` and `decision_record`. The subject of these six is the
 * tenant's OWN product, not this platform.
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
 *
 * ## Console style (Phase 3 ride-along) — R9 only
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` classes this
 * route as a form/dialog surface, not a list, and says such routes "ride along
 * in whichever wave touches them, taking R9 + R3 only". No wave touched it, so
 * the ride-along is done here explicitly rather than left as a gap.
 *
 * - **R9** — the page `<h1>Prompt Documents</h1>` and its 5-size icon are gone
 *   (`coord/layout.tsx:41-53` already renders the console title and the nav
 *   crumb). The description STAYS: it is not a restatement of the title, it
 *   names which content this is and states the versioning contract an editor
 *   needs before their first edit. Body padding moves from `p-6` to the
 *   console's `p-3 sm:p-6`; `space-y-8` is deliberately KEPT rather than
 *   narrowed to `space-y-4`, because the two `border-t` sections below are
 *   separate governance controls and their separation is what stops them
 *   reading as one.
 * - **R3** — nothing to correct at page scope. The one amber surface here
 *   (`PromptDocumentList`) is a warning callout, not a kind-keyed status hue,
 *   so there is no palette to enrol in `console/attention.test.ts`.
 */

import { NotebookText } from "lucide-react";
import { KindAuthorshipTierControl } from "./_components/KindAuthorshipTierControl";
import { PolicyUpstreamDialControl } from "./_components/PolicyUpstreamDialControl";
import { PolicyWriteDialControl } from "./_components/PolicyWriteDialControl";
import { PromptDocumentList } from "./_components/PromptDocumentList";
import { SessionComplianceSection } from "./_components/SessionComplianceSection";

export default function PromptDocumentsPage() {
  return (
    <div
      className="p-3 sm:p-6 space-y-8"
      data-testid="prompt-documents-page"
    >
      {/* R9 — no page <h1>: `coord/layout.tsx` already renders the console
          title and the nav crumb naming this route. The prose stays because it
          is not a restatement of the title — it names WHICH content this is and
          states the versioning contract an editor needs before their first
          edit. `space-y-8` is kept, not narrowed to `space-y-4`: the two
          `border-t` sections below are separate governance controls, and their
          separation is the thing that keeps them from reading as one. */}
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <NotebookText
          className="mt-0.5 size-4 shrink-0"
          aria-hidden
          data-testid="prompt-documents-icon"
        />
        <span>
          The prompt-shaped content coord serves your fleet, in two halves: how
          a session must act (session briefings, policy prose, response
          templates, continuation rules, agent playbooks, prompt templates, the
          Claude Code settings baseline) and what you are building (product
          intent, initiatives, success metrics, domain specs, audience profiles,
          decision records). Every edit is saved as a new version — prior
          wordings stay readable and restorable, and seeded documents can be
          reset to their shipped default.
        </span>
      </p>

      <PromptDocumentList />

      {/*
        The tenant-wide autonomy dial sits with the per-document write-access
        control it composes with. Two controls governing one question — "what
        may an agent do to this policy?" — belong on one page; the per-document
        setting decides WHETHER, this decides HOW MUCH, and the answer is the
        more restrictive of the two. Coord's own refusal message sends operators
        to this page for the first, so the second must be here too.
      */}
      {/*
        The per-KIND authorship tier sits between the per-document control in
        the list above and the tenant-wide dial below, because that is where it
        sits in coord's resolution order: floor, then per-document, then
        per-kind, then coord's compile-time default. It is also the only one of
        the three that can be set for a document that does not exist yet, which
        is the case the per-document control structurally cannot reach.
      */}
      <div className="border-t border-border pt-8">
        <KindAuthorshipTierControl />
      </div>

      <div className="border-t border-border pt-8">
        <PolicyWriteDialControl />
      </div>

      {/*
        The upstream dial sits immediately after the policy-write dial because
        the two are one question asked from opposite ends: what may an agent
        INSIDE this tenant do to these documents, and what may the fleet
        OUTSIDE it do to them. Both govern the documents listed above, and an
        operator deciding how much autonomy to allow needs to see both answers
        without leaving the page.
      */}
      <div className="border-t border-border pt-8">
        <PolicyUpstreamDialControl />
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
