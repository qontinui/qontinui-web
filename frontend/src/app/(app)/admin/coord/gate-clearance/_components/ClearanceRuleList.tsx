"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Pencil, Plus, ShieldOff, Trash2 } from "lucide-react";
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
          <div className="space-y-2" data-testid="tenant-clearance-rules">
            {tenantRules.map((rule) => (
              <RuleRow
                key={rule.policy_id}
                rule={rule}
                saving={saving}
                onEdit={() => onEdit(rule)}
                onDelete={() => setDeleteTarget(rule)}
              />
            ))}
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
          <div className="space-y-2" data-testid="system-clearance-rules">
            {systemRules.map((rule) => {
              const parsed = parseGateClearancePayload(rule.payload);
              // An unreadable built-in (unknown authority, or no payload at
              // all) still needs an override path — it is exactly the row a
              // user most wants to take over. Seed whatever class it names and
              // let them choose the authority; a built-in with no class at all
              // governs nothing, so there is nothing to override.
              const seedClass =
                parsed?.gate_class ?? rawGateClass(rule.payload);
              return (
                <RuleRow
                  key={rule.policy_id}
                  rule={rule}
                  saving={saving}
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
            })}
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
  onEdit?: () => void;
  onDelete?: () => void;
  onOverride?: () => void;
}

function RuleRow({ rule, saving, onEdit, onDelete, onOverride }: RuleRowProps) {
  const parsed = parseGateClearancePayload(rule.payload);
  const gateClass = rawGateClass(rule.payload);
  const inert = inertReason(rule);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3"
      data-testid="clearance-rule-row"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.name}</span>
          <Badge variant="outline" className="font-mono">
            {gateClass ?? "no class"}
          </Badge>
          <Badge variant={parsed ? "secondary" : "destructive"}>
            {parsed ? AUTHORITY_LABELS[parsed.authority] : "unreadable rule"}
          </Badge>
          {inert && (
            <Badge variant="warning" data-testid="clearance-rule-inert">
              inactive
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          priority {rule.priority}
          {rule.rationale ? ` · ${rule.rationale}` : ""}
        </p>
        {inert && (
          <p className="mt-0.5 flex items-start gap-1 text-[11px] text-warning">
            <ShieldOff className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{INERT_EXPLANATIONS[inert]}</span>
          </p>
        )}
      </div>

      <CoordAdminOnly>
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
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onEdit}
            disabled={saving}
            title="Edit rule"
            aria-label={`Edit ${rule.name}`}
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {onDelete && (
          <DestructiveButton
            size="sm"
            className="h-8 w-8 p-0"
            onClick={onDelete}
            disabled={saving}
            title="Delete rule"
            aria-label={`Delete ${rule.name}`}
          >
            <Trash2 className="size-4" />
          </DestructiveButton>
        )}
      </CoordAdminOnly>
    </div>
  );
}
