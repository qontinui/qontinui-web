"use client";

/**
 * /admin/coord/decision-policies — tenant-scoped authoring UI for v2
 * decision-domain `coord.policy_rules` rows (`decision_domain` + `mode` +
 * `payload`) in the `next_step` family.
 *
 * Plan `2026-09-06-decision-policy-rows-are-operator-only-to-create`, D3
 * (Phase 3a). Measured symptom the page exists for: an operator-approved
 * `pr_fix` row sat unwritten for seventeen days while 25,345 consults
 * escalated `escalated_no_policy`, because the console had no form for the
 * shape and the only working path was a logged-in tenant admin issuing a raw
 * HTTP request from a browser session.
 *
 * Why a page of its own rather than a domain selector on
 * `/admin/coord/automation-rules`: that surface authors v1 typed rules and its
 * `RuleKind` union is `terminal_auto_response | question_auto_answer` with no
 * `decision_domain`, no `mode` and no `payload` anywhere in the dialog — its
 * whole editor is built around a trigger/response pair a decision policy does
 * not have. The precedent is `/admin/coord/gate-clearance`, which made the
 * same split for the same reason. The CRUD chain is NOT duplicated: all three
 * surfaces run on `_shared/useCoordPolicies`.
 *
 * Scope: this is Phase 3(a) only. The plan's pending-proposals band (3b) waits
 * on coord's `GET …/proposals` route and lands separately — deliberately not
 * stubbed here, because a placeholder band is indistinguishable from an empty
 * queue.
 *
 * Auth posture, per `CoordLayout`'s own contract: the layout does NOT
 * admin-gate — any authenticated tenant member may VIEW these pages, and each
 * page gates its own MUTATIONS on `isCoordAdmin`. Reading which frame coord
 * serves for a domain is diagnostic; every control that writes a row is
 * wrapped in `CoordAdminOnly`. The coord proxy enforces tenant-admin
 * server-side (`require_coord_tenant_admin`) regardless, so this is the UX
 * half of a two-sided gate, never the only one.
 *
 * Crawl-safety: this is a child of the `/admin/coord` layout, which gates the
 * whole subtree on `user?.is_superuser` and renders `null` otherwise, so the
 * Spec-CI crawl never mounts this body — and it talks ONLY to the
 * always-registered `httpClient` (never a cloud-only extension slot), so there
 * is no slot `console.error` for the crawl gate to catch. Same posture as
 * every existing admin/coord page.
 *
 * ## Console style
 *
 * `frontend/docs/console-ui-style-guide.md`, via the executable primitives in
 * `components/console`: **R9** (no page `<h1>` — the coord layout renders the
 * console's only one; body `p-3 sm:p-6 space-y-4`), **R2/R4/R5** (the row list
 * is `RecordList` / `RecordRow` / `RecordDetail`) and **R3** (an audited
 * kind→attention table in `decisionPolicyStatus.ts`, enrolled in
 * `components/console/attention.test.ts`). No new visual vocabulary.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { RotateCcw, Scale, TriangleAlert } from "lucide-react";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import { DecisionPolicyEditorDialog } from "./_components/DecisionPolicyEditorDialog";
import { DecisionPolicyList } from "./_components/DecisionPolicyList";
import { useDecisionPolicies } from "./_hooks/useDecisionPolicies";
import { CREATE_IS_INERT, DECISION_POLICY_DOMAINS } from "./decisionPolicies";

export default function DecisionPoliciesPage() {
  const {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    create,
    patchRule,
    graduate,
    deleteRule,
    replaceRule,
  } = useDecisionPolicies();

  const [editorOpen, setEditorOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [editingRule, setEditingRule] = useState<CoordPolicyRow | null>(null);

  const openCreate = () => {
    setEditingRule(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: CoordPolicyRow) => {
    setEditingRule(rule);
    setEditorOpen(true);
  };

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="decision-policies-page">
      <div className="flex flex-wrap items-baseline gap-2">
        <Scale
          className="size-4 shrink-0 self-center text-muted-foreground"
          aria-hidden
        />
        {/* `<h2>`, not `<h1>` — `admin/coord/layout.tsx` renders the console's
            one `<h1>`, and Spec-CI matches it by role and exact name (R9). */}
        <h2 className="text-sm font-semibold">Decision Policies</h2>
        <p className="max-w-4xl text-xs text-muted-foreground">
          The frames coord serves when a session consults one of the{" "}
          {DECISION_POLICY_DOMAINS.length} next-step decision domains. With no
          row for a domain, every consult escalates to a human with{" "}
          <code className="font-mono">escalated_no_policy</code>.
        </p>
      </div>

      {/* The single most misread fact about this store, stated where an
          operator sees it before opening the form rather than only inside it:
          creating a row does not arm anything. */}
      <p
        className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground"
        data-testid="decision-policies-inert-banner"
      >
        {CREATE_IS_INERT}
      </p>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          Loading decision policies…
        </div>
      ) : (
        <>
          {/*
            A failed read is UNKNOWN, not "this workspace has no policies".
            The rows are KEPT whenever any are in hand (the hook does not clear
            them on error), because one flow needs them precisely here:
            `replaceRule`'s delete arm fails, its toast says both rows are
            listed — and the refetch that follows fails too, because it is the
            same outage. Hiding every row at that moment strands a duplicate
            live in coord with nothing on screen to reach it.
          */}
          {loadFailed && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
              data-testid="decision-policies-load-failed"
            >
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="text-sm">
                <p className="font-medium">
                  Decision policies could not be loaded.
                </p>
                <p className="mt-1 text-muted-foreground">
                  {rules.length > 0
                    ? "The rows below are the last successful read and may be out of date."
                    : "No rows are listed, which is not the same as this workspace having none."}{" "}
                  Retry once coord is reachable.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={retrying}
                  onClick={() => {
                    setRetrying(true);
                    void reload().finally(() => setRetrying(false));
                  }}
                  data-testid="decision-policies-retry"
                >
                  <RotateCcw className="size-4" />
                  {retrying ? "Retrying…" : "Retry"}
                </Button>
              </div>
            </div>
          )}

          {(!loadFailed || rules.length > 0) && (
            <DecisionPolicyList
              rules={rules}
              saving={saving}
              onCreate={openCreate}
              onEdit={openEdit}
              onDelete={(rule) => deleteRule(rule.policy_id)}
              onGraduate={graduate}
            />
          )}
        </>
      )}

      <DecisionPolicyEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editingRule}
        saving={saving}
        onCreate={create}
        onPatch={patchRule}
        onReplace={replaceRule}
      />

      <Button asChild variant="link" className="px-0 text-xs">
        <Link href="/admin/coord/policies">
          See which tenants have graduated a next-step domain on Policies →
        </Link>
      </Button>
    </div>
  );
}
