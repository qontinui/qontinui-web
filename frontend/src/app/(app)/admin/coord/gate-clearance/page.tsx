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
import { RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
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
    reload,
    create,
    patchRule,
    deleteRule,
    replaceRule,
  } = useGateClearanceRules();

  const [editorOpen, setEditorOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
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
    <div className="space-y-6 p-6" data-testid="gate-clearance-page">
      <div className="flex items-start gap-3">
        <ShieldCheck
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div>
          <h1 className="text-lg font-semibold">Gate Clearance</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Who may clear a coord gate, per gate class. A gate carries a class;
            the first matching rule decides whether an operator, a non-authoring
            agent, or any agent may clear it. Rules in this workspace outrank
            the system defaults; where nothing matches, coord falls back to a
            default that depends on the gate&apos;s audience.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Applies to your current workspace. See a gate&apos;s actual decision
            on the{" "}
            <Link href="/admin/coord/gates" className="underline">
              Gates
            </Link>{" "}
            page — each cleared gate names the rule and band that admitted it.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading clearance rules…
        </div>
      ) : (
        <>
          {/*
            A failed read is UNKNOWN, not "no rules" — but the two things this
            page renders do not fail the same way, so they are gated
            separately.

            The MATRIX is suppressed on any failed read.
            `resolveEffectiveAuthority` returns a definitive-looking answer for
            every class, and a wrong one here is wrong in the dangerous
            direction — it can show `operator_only` for a class that is
            actually looser. Computed from an empty set it is confidently
            wrong; computed from a stale set it is confidently out of date.
            Neither is worth rendering.

            The RULE LIST is kept whenever rules are in hand (the hook does not
            clear them on error, so a failed REFETCH leaves the last good
            list). It is not a resolved claim, it is rows the operator can
            still read and act on — and one flow needs them precisely here:
            `replaceRule`'s delete arm fails, its toast says "Both are listed —
            delete the old one to finish the change", and the refetch that
            follows fails too because it is the SAME outage. Hiding every row
            at that moment strands a duplicate clearance rule live in coord
            with no way to reach it.
          */}
          {loadFailed && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
              data-testid="gate-clearance-load-failed"
            >
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="text-sm">
                <p className="font-medium">
                  Clearance rules could not be loaded.
                </p>
                <p className="mt-1 text-muted-foreground">
                  The effective authority per class is unknown — this page will
                  not guess it.{" "}
                  {rules.length > 0
                    ? "The rules below are the last successful read and may be out of date."
                    : "No rules are listed, which is not the same as this workspace having none."}{" "}
                  Retry once coord is reachable.
                </p>
                {/* Refetches in place. A full browser reload also works, but it
                    re-mounts the whole console to retry one side-fetch. The
                    in-flight flag is local because nothing in the hook moves on
                    a refetch — `loading` is first-load only — so without it a
                    hanging coord leaves a dead button. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={retrying}
                  onClick={() => {
                    setRetrying(true);
                    void reload().finally(() => setRetrying(false));
                  }}
                  data-testid="gate-clearance-retry"
                >
                  <RotateCcw className="size-4" />
                  {retrying ? "Retrying…" : "Retry"}
                </Button>
              </div>
            </div>
          )}

          {!loadFailed && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Effective authority</h2>
              <p className="text-xs text-muted-foreground">
                What actually decides each class right now, resolved the way
                coord resolves it.
              </p>
              <EffectiveAuthorityMatrix rules={rules} />
            </section>
          )}

          {(!loadFailed || rules.length > 0) && (
            <ClearanceRuleList
              rules={rules}
              saving={saving}
              onCreate={openCreate}
              onEdit={openEdit}
              onOverrideSystemDefault={openOverride}
              onDelete={(rule) => deleteRule(rule.policy_id)}
            />
          )}
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

      <Button asChild variant="link" className="px-0 text-xs">
        <Link href="/admin/coord/gates">Go to Gates →</Link>
      </Button>
    </div>
  );
}
