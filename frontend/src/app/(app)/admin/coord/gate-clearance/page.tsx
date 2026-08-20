"use client";

/**
 * /admin/coord/gate-clearance — tenant-scoped authoring UI for the gate
 * clearance-authority matrix (coord `decision_domain = 'gate_clearance'` policy
 * rows). Plan
 * `2026-08-10-agent-gate-management-must-ship-in-the-product.md` Phase P3.
 *
 * The matrix has shipped in coord since #1249 and had NO product surface: a
 * rule was reachable only by a raw API call. This page is that surface — list,
 * create, edit, delete, plus the *effective* authority per class so a user can
 * see which band decided rather than inferring it.
 *
 * Why a page of its own rather than a domain selector on
 * `/admin/coord/automation-rules`: that surface authors v1 typed rules
 * (`kind` + `condition` + `action`) and its editor is built entirely around a
 * trigger/response pair a `gate_clearance` rule does not have — its whole body
 * is `payload`. Folding a second, structurally different rule shape into it
 * would cost predictability and discoverability, the top two UX gates, on a
 * page framed as "auto-respond to terminal output". The CRUD chain is NOT
 * duplicated: both surfaces run on `_shared/useCoordPolicies`, which was
 * extracted from `useAutomationRules` for exactly this.
 *
 * Auth posture, per `CoordLayout`'s own contract: the layout does NOT
 * admin-gate — any authenticated tenant member may VIEW these pages, and each
 * page gates its own MUTATIONS on `isCoordAdmin`. This page follows that: the
 * effective-authority matrix and the rule listing are readable by any member
 * (seeing who may clear a gate is diagnostic, not privileged), while every
 * control that writes a rule is wrapped in `CoordAdminOnly`. The coord proxy
 * enforces tenant-admin server-side regardless (`deny_unless_tenant_admin`),
 * so this is the UX half of a two-sided gate, never the only one.
 *
 * Crawl-safety: the `(app)` AppAuthGate redirects an unauthenticated visitor,
 * so the Spec-CI crawl never mounts this body; and it talks only to the
 * always-registered `httpClient` (never a cloud-only extension slot), so there
 * is no slot console.error for the crawl gate to catch.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import { ClearanceRuleEditorDialog } from "./_components/ClearanceRuleEditorDialog";
import { ClearanceRuleList } from "./_components/ClearanceRuleList";
import { EffectiveAuthorityMatrix } from "./_components/EffectiveAuthorityMatrix";
import { useGateClearanceRules } from "./_hooks/useGateClearanceRules";
import type { ClearanceAuthority } from "./gateClearance";

export default function GateClearancePage() {
  const {
    rules,
    loading,
    saving,
    loadFailed,
    create,
    patchRule,
    deleteRule,
    replaceRule,
  } = useGateClearanceRules();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CoordPolicyRow | null>(null);
  const [seed, setSeed] = useState<{
    gateClass: string;
    authority: ClearanceAuthority;
  } | null>(null);

  const openCreate = () => {
    setEditingRule(null);
    setSeed(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: CoordPolicyRow) => {
    setEditingRule(rule);
    setSeed(null);
    setEditorOpen(true);
  };
  const openOverride = (next: {
    gateClass: string;
    authority: ClearanceAuthority;
  }) => {
    setEditingRule(null);
    setSeed(next);
    setEditorOpen(true);
  };

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="gate-clearance-page">
      <div className="flex flex-wrap items-baseline gap-2">
        <ShieldCheck
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
        <h2 className="text-sm font-semibold">Gate Clearance</h2>
        <p className="max-w-4xl text-xs text-muted-foreground">
          Who may clear a coord gate, per gate class, in this workspace. A gate
          carries a class; the first matching rule decides whether an operator,
          a non-authoring agent, or any agent may clear it. Workspace rules
          outrank the system defaults; where nothing matches, coord falls back
          to a default that depends on the gate&apos;s audience.
        </p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading clearance rules…
        </div>
      ) : loadFailed ? (
        // A failed read is UNKNOWN, not "no rules". Rendering the matrix here
        // would state an effective authority for every class computed from an
        // empty set — precisely the wrong answer, confidently.
        <div
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
          data-testid="gate-clearance-load-failed"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="text-sm">
            <p className="font-medium">Clearance rules could not be loaded.</p>
            <p className="mt-1 text-muted-foreground">
              The effective authority per class is unknown — this page will not
              guess it. Reload once coord is reachable.
            </p>
          </div>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Effective authority</h2>
            <p className="text-xs text-muted-foreground">
              What actually decides each class right now, resolved the way coord
              resolves it.
            </p>
            <EffectiveAuthorityMatrix rules={rules} />
          </section>

          <ClearanceRuleList
            rules={rules}
            saving={saving}
            onCreate={openCreate}
            onEdit={openEdit}
            onOverrideSystemDefault={openOverride}
            onDelete={(rule) => deleteRule(rule.policy_id)}
          />
        </>
      )}

      <ClearanceRuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editingRule}
        seed={seed}
        rules={rules}
        saving={saving}
        onCreate={create}
        onPatch={patchRule}
        onReplace={replaceRule}
      />

      {/* The pointer the deleted second header paragraph carried, folded into
          the link that was already here: each cleared gate on /gates names the
          rule and band that admitted it. */}
      <Button asChild variant="link" className="px-0 text-xs">
        <Link href="/admin/coord/gates">
          See a gate&apos;s actual decision on Gates →
        </Link>
      </Button>
    </div>
  );
}
