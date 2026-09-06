"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
} from "@/components/console";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus } from "lucide-react";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  domainSpec,
  isLoosening,
  MASTER_FLAG_CAVEAT,
  MODE_LABELS,
  parseAutonomyLevel,
  type AutonomyLevel,
} from "../decisionPolicies";
import {
  DECISION_POLICY_PALETTE,
  deriveDecisionPolicyStatus,
  rowPayloadWarnings,
} from "../decisionPolicyStatus";

export interface DecisionPolicyListProps {
  rules: readonly CoordPolicyRow[];
  saving: boolean;
  onCreate: () => void;
  onEdit: (rule: CoordPolicyRow) => void;
  onDelete: (rule: CoordPolicyRow) => Promise<boolean>;
  onGraduate: (policyId: string, level: AutonomyLevel) => Promise<boolean>;
}

/**
 * The decision-policy rows.
 *
 * Console style, per `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R2 / R4** — one record is one `<RecordRow>` line with the left-edge
 *   accent derived from the row's own `attention`.
 * - **R5** — `<RecordList>` keeps one detail open at a time; the detail
 *   carries the payload evidence and every write control, in the fixed
 *   `why / problems / actions / raw` order.
 * - **R3** — `../decisionPolicyStatus.ts` is the audited kind→attention table,
 *   enrolled in `components/console/attention.test.ts`'s registry.
 * - **R9** — no page `<h1>`; the coord layout owns the console's only one.
 *
 * Every WRITE control is wrapped in `CoordAdminOnly`. The coord proxy enforces
 * tenant-admin server-side (`require_coord_tenant_admin`) regardless, so this
 * is the UX half of a two-sided gate, never the only one.
 *
 * **The graduation control lives here rather than in the editor dialog**, and
 * that is a decision: `autonomy_level` is the one field on this page that
 * changes what coord DOES, it is PATCH-only by construction (coord#920), and a
 * payload edit takes the replace path which resets it to the column default. A
 * graduation set in the editor and saved beside a payload change would be
 * silently discarded. One field, one PATCH, one confirm, on the live row.
 *
 * The confirm-before-loosening gate is not invented here either: it extends
 * `automation-rules/_components/RuleEditorDialog.tsx`'s `window.confirm` on
 * turning `auto_decide` on, from the one v1 rule kind that had it to the whole
 * three-value dial — a tightening needs no confirm, and every loosening does.
 */
export function DecisionPolicyList({
  rules,
  saving,
  onCreate,
  onEdit,
  onDelete,
  onGraduate,
}: DecisionPolicyListProps) {
  const [deleteTarget, setDeleteTarget] = useState<CoordPolicyRow | null>(null);
  const [openRule, setOpenRule] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Decision policies</h2>
          <p className="text-xs text-muted-foreground">
            One row per decision domain coord consults. The first matching row
            decides; a repo-scoped row outranks a workspace-wide one.
          </p>
        </div>
        <CoordAdminOnly fallback={<ReadOnlyNotice />}>
          <Button onClick={onCreate} data-testid="new-decision-policy">
            <Plus className="size-4" />
            New policy
          </Button>
        </CoordAdminOnly>
      </div>

      {rules.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border py-10 text-center"
          data-testid="no-decision-policies"
        >
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">
            No decision policies in this workspace. Every consult for these
            domains escalates with{" "}
            <code className="font-mono">escalated_no_policy</code> — coord has
            no frame to serve, so it asks a human every time.
          </p>
          <CoordAdminOnly>
            <Button variant="outline" className="mt-3" onClick={onCreate}>
              <Plus className="size-4" />
              Create your first policy
            </Button>
          </CoordAdminOnly>
        </div>
      ) : (
        <div data-testid="decision-policy-rows">
          <RecordList
            items={[...rules]}
            itemKey={(r) => r.policy_id}
            expandedKey={openRule}
            onExpandedKeyChange={setOpenRule}
            renderRow={(rule, ctx) => (
              <PolicyRow
                rule={rule}
                saving={saving}
                expanded={ctx.expanded}
                onToggle={ctx.onToggle}
                onEdit={() => onEdit(rule)}
                onDelete={() => setDeleteTarget(rule)}
                onGraduate={onGraduate}
              />
            )}
          />
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="decision-policy-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this decision policy?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  <span className="font-medium">{deleteTarget?.name}</span> is
                  the frame coord serves for{" "}
                  <code className="font-mono">
                    {deleteTarget?.decision_domain}
                  </code>
                  . After deleting it, consults for that domain fall back to any
                  lower-ranked row — and if there is none, to{" "}
                  <code className="font-mono">escalated_no_policy</code>.
                </p>
                <p className="text-xs">
                  Coord&apos;s delete is a soft delete with no tombstone, so
                  this is not reversible from the console: restore it by
                  creating the row again, which lands at{" "}
                  <code className="font-mono">always_escalate</code>.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void onDelete(deleteTarget);
                setDeleteTarget(null);
              }}
            >
              Delete policy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface PolicyRowProps {
  rule: CoordPolicyRow;
  saving: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onGraduate: (policyId: string, level: AutonomyLevel) => Promise<boolean>;
}

function PolicyRow({
  rule,
  saving,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onGraduate,
}: PolicyRowProps) {
  const status = deriveDecisionPolicyStatus(rule);
  const warnings = rowPayloadWarnings(rule);
  const level = parseAutonomyLevel(rule.autonomy_level);

  return (
    <RecordRow
      data-testid="decision-policy-row"
      rowKey={rule.policy_id}
      expanded={expanded}
      onToggle={onToggle}
      attention={status.attention}
      identity={rule.decision_domain ?? "no domain"}
      label={
        <span title={rule.rationale ?? rule.name}>
          <span className="font-medium">{rule.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · {rule.repo ?? "whole workspace"}
          </span>
        </span>
      }
      status={
        <span
          className="inline-flex shrink-0"
          data-testid="decision-policy-status"
          data-autonomy-level={rule.autonomy_level}
        >
          <StatusBadge status={status} palette={DECISION_POLICY_PALETTE} />
        </span>
      }
      reason={`${rule.mode} · priority ${rule.priority}`}
      time={
        <RowTime
          at={rule.updated_at ?? rule.created_at ?? null}
          verb={rule.updated_at ? "Updated" : "Created"}
          absent={{
            label: "no date",
            title: "coord recorded no timestamp for this row.",
          }}
        />
      }
    >
      <RecordDetail
        why={
          <div className="space-y-1 text-xs">
            <p>
              <span className="text-muted-foreground">Autonomy: </span>
              <span
                className="text-foreground/90"
                data-testid="decision-policy-autonomy"
              >
                {level ? AUTONOMY_LABELS[level] : rule.autonomy_level}
              </span>
              {level && (
                <span className="text-muted-foreground">
                  {" "}
                  — {AUTONOMY_DESCRIPTIONS[level]}
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              mode {MODE_LABELS[rule.mode as keyof typeof MODE_LABELS] ?? rule.mode} ·
              priority {rule.priority} ·{" "}
              {rule.enabled ? "enabled" : "disabled"}
              {rule.rationale ? ` · ${rule.rationale}` : ""}
            </p>
            <p className="text-muted-foreground">
              {domainSpec(rule.decision_domain)?.description}
            </p>
          </div>
        }
        problems={
          warnings === null || warnings.length > 0 ? (
            <div
              className="space-y-1 text-[11px] text-warning"
              data-testid="decision-policy-problems"
            >
              {(warnings ?? [
                `coord served mode \`${rule.mode}\`, which this console does not know — what it serves for this domain is unknown.`,
              ]).map((w) => (
                <p key={w} className="flex items-start gap-1">
                  <AlertTriangle
                    className="mt-0.5 size-3 shrink-0"
                    aria-hidden
                  />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          ) : undefined
        }
        actions={
          <CoordAdminOnly>
            <div className="space-y-3">
              <GraduationControl
                rule={rule}
                saving={saving}
                onGraduate={onGraduate}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  disabled={saving}
                  aria-label={`Edit ${rule.name}`}
                >
                  Edit policy
                </Button>
                <DestructiveButton
                  size="sm"
                  onClick={onDelete}
                  disabled={saving}
                  aria-label={`Delete ${rule.name}`}
                >
                  Delete policy
                </DestructiveButton>
              </div>
            </div>
          </CoordAdminOnly>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            policy_id: {rule.policy_id}
            {` · decision_domain: ${rule.decision_domain ?? "null"}`}
            {` · mode: ${rule.mode}`}
            {` · autonomy_level: ${rule.autonomy_level}`}
            {` · band: ${rule.built_in ? "system" : "tenant"}`}
            {rule.repo ? ` · repo: ${rule.repo}` : ""}
            {rule.expires_at ? ` · expires_at: ${rule.expires_at}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}

/**
 * The graduation control: the current `autonomy_level` and the dial that moves
 * it, with a confirm on every LOOSENING and none on a tightening.
 *
 * A row coord served at an unknown level renders no dial at all. Offering one
 * would mean choosing a "current" value we do not know, and the first thing
 * the operator would do with it is overwrite a state neither side understands.
 */
function GraduationControl({
  rule,
  saving,
  onGraduate,
}: {
  rule: CoordPolicyRow;
  saving: boolean;
  onGraduate: (policyId: string, level: AutonomyLevel) => Promise<boolean>;
}) {
  const current = parseAutonomyLevel(rule.autonomy_level);
  const spec = domainSpec(rule.decision_domain);

  if (current === null) {
    return (
      <p
        className="text-xs text-warning"
        data-testid="decision-policy-graduation-unknown"
      >
        coord served autonomy_level{" "}
        <code className="font-mono">{rule.autonomy_level}</code>, which this
        console does not know. It will not offer to change a level it cannot
        read.
      </p>
    );
  }

  const change = (next: AutonomyLevel) => {
    if (next === current) return;
    if (isLoosening(current, next)) {
      const message =
        `Loosen ${rule.name} from ${current} to ${next}?\n\n` +
        `${AUTONOMY_DESCRIPTIONS[next]}\n\n` +
        (spec?.requiresMaster ? `${MASTER_FLAG_CAVEAT}\n\n` : "") +
        "Tightening back is a single change and needs no confirmation.";
      if (!window.confirm(message)) return;
    }
    void onGraduate(rule.policy_id, next);
  };

  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Autonomy
      </p>
      <Select
        value={current}
        onValueChange={(v) => change(v as AutonomyLevel)}
        disabled={saving}
      >
        <SelectTrigger
          className="w-full sm:w-72"
          aria-label={`Autonomy level for ${rule.name}`}
          data-testid="decision-policy-graduation"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AUTONOMY_LEVELS.map((l) => (
            <SelectItem key={l} value={l}>
              {AUTONOMY_LABELS[l]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {AUTONOMY_DESCRIPTIONS[current]}
        {spec?.requiresMaster && current === "auto_decide"
          ? ` ${MASTER_FLAG_CAVEAT}`
          : ""}
      </p>
    </div>
  );
}
