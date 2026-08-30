"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  RecordDetail,
  RecordList,
  RecordRow,
  RowTime,
  StatusBadge,
  rowAccentClass,
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
import { Plus, ShieldOff } from "lucide-react";
import {
  CoordAdminOnly,
  ReadOnlyNotice,
} from "@/components/admin/coord/CoordAdminOnly";
import type { CoordPolicyRow } from "../../_shared/coordPolicies";
import {
  AUTHORITY_LABELS,
  INERT_EXPLANATIONS,
  inertReason,
  parseGateClearancePayload,
  rawGateClass,
  resolveWithout,
  type ClearanceAuthority,
} from "../gateClearance";
import {
  CLEARANCE_STATUS_PALETTE,
  deriveClearanceRuleStatus,
} from "../clearanceRuleStatus";
import { EffectiveAuthorityCell } from "./EffectiveAuthorityMatrix";

export interface ClearanceRuleListProps {
  rules: readonly CoordPolicyRow[];
  saving: boolean;
  onCreate: () => void;
  onEdit: (rule: CoordPolicyRow) => void;
  onOverrideSystemDefault: (seed: {
    gateClass: string;
    authority: ClearanceAuthority;
  }) => void;
  onDelete: (rule: CoordPolicyRow) => Promise<boolean>;
}

/**
 * The rule rows themselves, split into the two bands coord resolves.
 *
 * Every WRITE control is wrapped in `CoordAdminOnly` — a non-admin tenant
 * member may read the matrix and the rules (diagnostic) but is not shown
 * controls the coord proxy would 403 anyway (`deny_unless_tenant_admin`).
 *
 * System defaults are shown but not edited or deleted here: coord's
 * system-override routes are v1-shaped and its v2 domain resolver ignores
 * override rows entirely, so a "disable this built-in" control would report
 * success while the built-in kept deciding. The working — and reversible —
 * override is a workspace rule for the same class, which outranks the system
 * band; removing that rule restores the default.
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` moved these
 * rows onto `<RecordRow>` / `<RecordDetail>`. Its §4 census filed this route as
 * a table; only the sibling `EffectiveAuthorityMatrix` is one — these rows were
 * a Family-B fat row wearing no `<Card>` (three stacked lines at `px-3 py-3`),
 * which is why the `<Card>`-keyed census missed them. See
 * `../clearanceRuleStatus.ts` for that correction in full and for the R3
 * reading of "inactive".
 *
 * **R3, and the split it makes.** The list painted every not-in-play rule with
 * one amber `inactive` badge. Two of `inertReason`'s five answers are a CHOICE
 * (`disabled`, `expired` — an off switch that is off, an expiry that lapsed as
 * asked) and three are a DEFECT (`repo-scoped`, `no-class`,
 * `unknown-authority` — a rule coord's resolver can never match, while the
 * operator believes it is governing the class). Only the second group is red.
 *
 * **The row actions moved into the detail.** `<RecordRow>` renders the whole
 * line as ONE `<button>` so the expand affordance is keyboard-reachable, and a
 * button nested in a button is invalid HTML. Edit / Delete / "Override here"
 * are one click deeper as a result, which is the right trade on a page where
 * the destructive one is a rule deletion: they are also now beside the
 * evidence you would want before pressing them.
 *
 * Every authored `data-testid` is carried across unchanged (D4a):
 * `clearance-rule-row`, `clearance-rule-inert`, `tenant-clearance-rules`,
 * `system-clearance-rules`, `no-system-clearance-rules`,
 * `new-clearance-rule`, `clearance-delete-confirm`.
 */
export function ClearanceRuleList({
  rules,
  saving,
  onCreate,
  onEdit,
  onOverrideSystemDefault,
  onDelete,
}: ClearanceRuleListProps) {
  const [deleteTarget, setDeleteTarget] = useState<CoordPolicyRow | null>(null);
  /**
   * The open rule (R5 — one at a time), hoisted across BOTH bands so opening a
   * system default closes an open workspace rule. Two independent
   * `<RecordList>`s each keeping their own key would let two details sit open
   * at once, which is the thing R5 exists to prevent.
   */
  const [openRule, setOpenRule] = useState<string | null>(null);

  const tenantRules = rules.filter((r) => !r.built_in);
  const systemRules = rules.filter((r) => r.built_in);

  const deleteClass = deleteTarget ? rawGateClass(deleteTarget.payload) : null;
  const afterDelete =
    deleteTarget && deleteClass
      ? resolveWithout(rules, deleteClass, deleteTarget.policy_id)
      : null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">
              This workspace&apos;s rules
            </h2>
            <p className="text-xs text-muted-foreground">
              These outrank the system defaults for the same class, whatever
              their priority.
            </p>
          </div>
          <CoordAdminOnly fallback={<ReadOnlyNotice />}>
            <Button onClick={onCreate} data-testid="new-clearance-rule">
              <Plus className="size-4" />
              New rule
            </Button>
          </CoordAdminOnly>
        </div>

        {tenantRules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No clearance rules in this workspace — every class falls to the
              system defaults below, then to coord&apos;s audience default.
            </p>
            <CoordAdminOnly>
              <Button variant="outline" className="mt-3" onClick={onCreate}>
                <Plus className="size-4" />
                Create your first rule
              </Button>
            </CoordAdminOnly>
          </div>
        ) : (
          <div data-testid="tenant-clearance-rules">
            <RecordList
              items={tenantRules}
              itemKey={(r) => r.policy_id}
              expandedKey={openRule}
              onExpandedKeyChange={setOpenRule}
              renderRow={(rule, ctx) => (
                <RuleRow
                  rule={rule}
                  saving={saving}
                  expanded={ctx.expanded}
                  onToggle={ctx.onToggle}
                  onEdit={() => onEdit(rule)}
                  onDelete={() => setDeleteTarget(rule)}
                />
              )}
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">System defaults</h2>
          <p className="text-xs text-muted-foreground">
            Shipped with coord and applied to every workspace that has not
            written its own rule for the class. They cannot be edited or turned
            off directly — add a rule of your own for the same class to take
            over, and delete it to hand the class back.
          </p>
        </div>

        {systemRules.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground"
            data-testid="no-system-clearance-rules"
          >
            This coord serves no system-band clearance defaults. Classes with no
            workspace rule fall straight to coord&apos;s audience default.
          </p>
        ) : (
          <div data-testid="system-clearance-rules">
            <RecordList
              items={systemRules}
              itemKey={(r) => r.policy_id}
              expandedKey={openRule}
              onExpandedKeyChange={setOpenRule}
              renderRow={(rule, ctx) => {
                const parsed = parseGateClearancePayload(rule.payload);
                // An unreadable built-in (unknown authority, or no payload at
                // all) still needs an override path — it is exactly the row a
                // user most wants to take over. Seed whatever class it names
                // and let them choose the authority; a built-in with no class
                // at all governs nothing, so there is nothing to override.
                const seedClass =
                  parsed?.gate_class ?? rawGateClass(rule.payload);
                return (
                  <RuleRow
                    rule={rule}
                    saving={saving}
                    expanded={ctx.expanded}
                    onToggle={ctx.onToggle}
                    onOverride={
                      seedClass
                        ? () =>
                            onOverrideSystemDefault({
                              gateClass: seedClass,
                              authority: parsed?.authority ?? "operator_only",
                            })
                        : undefined
                    }
                  />
                );
              }}
            />
          </div>
        )}
      </section>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="clearance-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clearance rule?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteClass === null ? (
                  <p>
                    <span className="font-medium">{deleteTarget?.name}</span>{" "}
                    names no gate class, so it decides nothing today. Deleting
                    it changes no gate&apos;s clearance authority.
                  </p>
                ) : (
                  <p>
                    <span className="font-medium">{deleteTarget?.name}</span>{" "}
                    decides who may clear{" "}
                    <code className="font-mono">{deleteClass}</code> gates.
                    After deleting it, that class is decided by:
                  </p>
                )}
                {afterDelete && (
                  <div className="rounded-md border border-border bg-muted/40 p-3">
                    <EffectiveAuthorityCell effective={afterDelete} />
                  </div>
                )}
                <p className="text-xs">
                  You can restore this by creating the same rule again — nothing
                  about past gate decisions changes.
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
              Delete rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface RuleRowProps {
  rule: CoordPolicyRow;
  saving: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}

function RuleRow({
  rule,
  saving,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onOverride,
}: RuleRowProps) {
  const parsed = parseGateClearancePayload(rule.payload);
  const gateClass = rawGateClass(rule.payload);
  const inert = inertReason(rule);
  const status = deriveClearanceRuleStatus(rule);

  return (
    <RecordRow
      data-testid="clearance-rule-row"
      rowKey={rule.policy_id}
      expanded={expanded}
      onToggle={onToggle}
      accent={rowAccentClass(status)}
      attention={status.attention}
      identity={gateClass ?? "no class"}
      label={
        <span title={rule.rationale ?? rule.name}>
          <span className="font-medium">{rule.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · {parsed ? AUTHORITY_LABELS[parsed.authority] : "unreadable rule"}
          </span>
        </span>
      }
      status={
        // Wrapped so `clearance-rule-inert` — the frozen authored testid for
        // "this rule is not in play" — survives the badge becoming a
        // `<StatusBadge>`. It is emitted for exactly the rows that carried it
        // before: any rule with an `inertReason`, choice or defect alike.
        inert ? (
          <span
            className="inline-flex shrink-0"
            data-testid="clearance-rule-inert"
            data-inert-reason={inert}
          >
            <StatusBadge status={status} palette={CLEARANCE_STATUS_PALETTE} />
          </span>
        ) : (
          <StatusBadge status={status} palette={CLEARANCE_STATUS_PALETTE} />
        )
      }
      reason={`priority ${rule.priority}`}
      time={
        <RowTime
          at={rule.updated_at ?? rule.created_at ?? null}
          verb={rule.updated_at ? "Updated" : "Created"}
          absent={{
            label: "no date",
            title: "coord recorded no timestamp for this rule.",
          }}
        />
      }
    >
      <RecordDetail
        why={
          <div className="space-y-1 text-xs">
            <p>
              <span className="text-muted-foreground">Authority: </span>
              <span className="text-foreground/90">
                {parsed
                  ? AUTHORITY_LABELS[parsed.authority]
                  : "unreadable — coord skips this rule"}
              </span>
            </p>
            <p className="text-muted-foreground">
              priority {rule.priority}
              {rule.rationale ? ` · ${rule.rationale}` : ""}
            </p>
          </div>
        }
        problems={
          inert ? (
            <p className="flex items-start gap-1 text-[11px] text-warning">
              <ShieldOff className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>{INERT_EXPLANATIONS[inert]}</span>
            </p>
          ) : undefined
        }
        actions={
          <CoordAdminOnly>
            <div className="flex flex-wrap items-center gap-2">
              {onOverride && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOverride}
                  disabled={saving}
                >
                  Override here
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEdit}
                  disabled={saving}
                  aria-label={`Edit ${rule.name}`}
                >
                  Edit rule
                </Button>
              )}
              {onDelete && (
                <DestructiveButton
                  size="sm"
                  onClick={onDelete}
                  disabled={saving}
                  aria-label={`Delete ${rule.name}`}
                >
                  Delete rule
                </DestructiveButton>
              )}
            </div>
          </CoordAdminOnly>
        }
        raw={
          <div className="font-mono text-[10px] text-muted-foreground/60 break-all">
            policy_id: {rule.policy_id}
            {gateClass ? ` · gate_class: ${gateClass}` : ""}
            {` · band: ${rule.built_in ? "system" : "tenant"}`}
            {rule.repo ? ` · repo: ${rule.repo}` : ""}
            {rule.expires_at ? ` · expires_at: ${rule.expires_at}` : ""}
          </div>
        }
      />
    </RecordRow>
  );
}
