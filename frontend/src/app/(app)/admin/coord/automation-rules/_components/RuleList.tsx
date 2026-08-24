"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Switch } from "@/components/ui/switch";
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
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Terminal,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { useAutomationRules } from "../_hooks/useAutomationRules";
import { RuleEditorDialog } from "./RuleEditorDialog";
import type { PolicyAction, PolicyCondition, PolicyRow } from "../types";

/** Best-effort one-line summary of a rule's trigger condition. */
function conditionSummary(row: PolicyRow): string {
  const cond = row.condition as PolicyCondition | Record<string, never>;
  if ("type" in cond) {
    if (cond.type === "terminal_regex_match") return cond.pattern;
    if (cond.type === "question_match")
      return (cond.question_contains ?? []).join(" + ");
  }
  return "—";
}

/** Best-effort one-line summary of a rule's resolution action. */
function actionSummary(row: PolicyRow): string {
  const action = row.action as PolicyAction | Record<string, never>;
  if ("type" in action) {
    if (action.type === "submit_prompt") return `→ ${action.text}`;
    if (action.type === "auto_answer") return `→ ${action.response}`;
    if (action.type === "resolve_by_scoring")
      return `→ score ${action.options.length} option(s) on ${action.surface}`;
    if (action.type === "meta_answer")
      return "→ decision-delegation meta-answer";
  }
  return "";
}

export function RuleList() {
  const {
    rules,
    loading,
    saving,
    loadFailed,
    reload,
    createRule,
    updateRule,
    restoreDefault,
    deleteRule,
    overrideRule,
    revertOverride,
  } = useAutomationRules();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PolicyRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyRow | null>(null);
  // A workspace rule's OFF position is not a state this console can read back
  // — see the dialog below. It is confirmed, never applied on the click.
  const [disableTarget, setDisableTarget] = useState<PolicyRow | null>(null);
  const [retrying, setRetrying] = useState(false);

  const openCreate = () => {
    setEditingRule(null);
    setEditorOpen(true);
  };
  const openEdit = (rule: PolicyRow) => {
    setEditingRule(rule);
    setEditorOpen(true);
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Loading rules…
      </div>
    );
  }

  /*
    A failed list read is UNKNOWN, not "no rules" — and `useCoordPolicies`
    reports the two states through DIFFERENT channels, so the render has to
    split on both. It leaves `rules` untouched when a call throws: `[]` on a
    failed FIRST load, but the last good list on a failed REFETCH.

    Failed and empty is the one that used to lie. The empty-state card below
    read `[]` as a fact about the workspace — announcing there are no
    automation rules and offering to create the first one, on a page whose
    rules may all be sitting in coord untouched. Creating from that state
    duplicates a live rule; believing it mis-diagnoses an outage as data loss.
    That reading got sharper when the off-switch became a soft DELETE: "my
    rules are gone" is now something an operator can do to themselves on this
    very screen, so a false empty looks like a confirmation of the mistake they
    most fear having made.

    Failed with rules in hand is NOT that. Replacing a list we still hold with
    an error panel would throw away real (if possibly stale) information to
    report a refresh failure — so that case keeps the list and says the list is
    the last successful read.

    The COPY shape is `/admin/coord/gate-clearance`'s (`gate-clearance-load-failed`);
    the posture deliberately is NOT. That page replaces its whole body on any
    failed read, because its primary artifact is the effective-authority matrix
    — "who may clear a gate", rendered stale, is a worse answer than none. A
    list of rules the operator can still read and act on is not, so this
    surface keeps it.
  */
  const failedPanel = loadFailed ? (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      data-testid="automation-rules-load-failed"
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-destructive"
        aria-hidden
      />
      <div className="text-sm">
        <p className="font-medium">Automation rules could not be loaded.</p>
        <p className="mt-1 text-muted-foreground">
          {rules.length === 0
            ? "This is not the same as having none — the rules in this workspace are unknown right now, so none are listed and none can be edited."
            : "The rules below are the last successful read and may be out of date. Anything changed since then is not reflected here."}{" "}
          Retry once coord is reachable.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={retrying}
          onClick={() => {
            // `reload` never rejects (the hook catches), so `finally` is the
            // whole story. The flag exists because nothing else moves on a
            // click: a refetch does not raise `loading` after the first load,
            // so without it a coord that hangs gives the operator a dead
            // button and they press it again.
            setRetrying(true);
            void reload().finally(() => setRetrying(false));
          }}
          data-testid="automation-rules-retry"
        >
          <RotateCcw className="size-4" />
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </div>
  ) : null;

  // Nothing to show AND no basis for saying so.
  const nothingKnown = loadFailed && rules.length === 0;

  return (
    <div className="space-y-4">
      {/* Authoring blind against a list that failed to load is how a duplicate
          of a live rule gets made — so this is withheld, not just disabled. */}
      {!nothingKnown && (
        <div className="flex justify-end">
          <Button onClick={openCreate} data-testid="new-rule">
            <Plus className="size-4" />
            New Rule
          </Button>
        </div>
      )}

      {failedPanel}

      {nothingKnown ? null : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No automation rules yet.
          </p>
          <Button variant="outline" className="mt-3" onClick={openCreate}>
            <Plus className="size-4" />
            Create your first rule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <RuleRow
              key={rule.policy_id}
              rule={rule}
              saving={saving}
              onToggle={(enabled) => {
                if (rule.built_in) {
                  if (!rule.system_rule_id) return;
                  // Toggling a built-in doesn't PATCH the system-owned row.
                  // OFF → override with {disabled:true}; ON → revert to built-in.
                  if (enabled) void revertOverride(rule.system_rule_id);
                  else void overrideRule(rule.system_rule_id, { disabled: true });
                } else {
                  // A workspace row can only ever arrive ENABLED (coord's list
                  // route defaults to `enabled = true` and no caller asks for
                  // the other arm), so its switch is only ever clicked OFF.
                  // There is deliberately no ON branch: the PATCH it would
                  // make writes `enabled` — coord's soft-delete column — so
                  // the day someone lists the disabled arm, a branch kept
                  // "just in case" would quietly become the destructive write
                  // this dialog exists to stop.
                  setDisableTarget(rule);
                }
              }}
              onEdit={() => openEdit(rule)}
              onDelete={() => setDeleteTarget(rule)}
              onRevert={() => {
                if (rule.system_rule_id) void revertOverride(rule.system_rule_id);
              }}
            />
          ))}
        </div>
      )}

      <RuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rule={editingRule}
        saving={saving}
        onCreate={createRule}
        onUpdate={updateRule}
        onRestore={restoreDefault}
        onOverride={overrideRule}
      />

      {/*
        Turning a WORKSPACE rule off is not a reversible disable, however much
        a switch implies one. Coord's `DELETE /coord/policies/:id` is a soft
        delete that sets this very column (`policies/routes.rs::delete_soft` —
        `SET enabled = false`), `coord.policy_rules` carries no tombstone to
        tell the two apart, and the list route's default (`enabled = true`)
        then drops the row. So the switch used to write a state nothing could
        read back: the rule vanished and could not be turned on again.

        Rather than pretend otherwise, the OFF position is confirmed and routed
        to the delete it actually is — which also gets coord's own operator
        stamping (`operator_actor`) instead of a PATCH that leaves the row
        looking self-modified. A genuine disable needs coord to separate the
        two meanings first; until then two controls doing the same thing under
        different names is the worse outcome.

        BUILT-INS are untouched by this: their switch runs the override routes
        (`{disabled: true}` / `revertOverride`), which really are reversible.
      */}
      <AlertDialog
        open={disableTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDisableTarget(null);
        }}
      >
        <AlertDialogContent data-testid="automation-disable-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn this rule off?</AlertDialogTitle>
            <AlertDialogDescription>
              Coord has no reversible &ldquo;off&rdquo; for a workspace rule:
              turning{" "}
              <span className="font-medium">{disableTarget?.name}</span> off is
              the same soft delete as the Delete button, and it will not be
              listed here again. Re-create it to bring it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disableTarget) void deleteRule(disableTarget.policy_id);
                setDisableTarget(null);
              }}
            >
              Turn off and delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <span className="font-medium">{deleteTarget?.name}</span>. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void deleteRule(deleteTarget.policy_id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface RuleRowProps {
  rule: PolicyRow;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onRevert: () => void;
}

function RuleRow({
  rule,
  saving,
  onToggle,
  onEdit,
  onDelete,
  onRevert,
}: RuleRowProps) {
  const isTerminal = rule.kind === "terminal_auto_response";
  const KindIcon = isTerminal ? Terminal : MessageSquare;

  const builtIn = rule.built_in;
  // A built-in is "on" for this tenant unless the tenant has disabled it.
  const switchChecked = builtIn ? rule.override_state !== "disabled" : rule.enabled;
  const isCustomized = builtIn && rule.override_state === "customized";
  const isDisabled = builtIn && rule.override_state === "disabled";

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
      <KindIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.name}</span>
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {isTerminal ? "Terminal" : "Question"}
          </span>
          {builtIn && (
            <span
              className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
              title="Built-in — applies to everyone. Turn it off here for just your workspace, or make your own version."
            >
              Built-in
            </span>
          )}
          {isDisabled && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Disabled
            </span>
          )}
          {isCustomized && (
            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Customized
            </span>
          )}
        </div>
        <code className="block truncate text-xs text-muted-foreground">
          {conditionSummary(rule)} {actionSummary(rule)}
        </code>
        {builtIn && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            Built-in — applies to everyone. Turn it off here for just your
            workspace, or make your own version.
          </p>
        )}
      </div>

      <Switch
        checked={switchChecked}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label={builtIn ? "Enabled for my workspace" : "Enabled"}
      />

      {/* Revert-to-built-in — only when this tenant has customized the built-in. */}
      {isCustomized && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onRevert}
          disabled={saving}
          title="Revert to built-in"
        >
          <RotateCcw className="size-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title={builtIn ? "Customize for your workspace" : "Edit rule"}
      >
        <Pencil className="size-4" />
      </Button>

      {/* A tenant can't delete a built-in — only disable/customize/revert. */}
      {!builtIn && (
        <DestructiveButton
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onDelete}
          title="Delete rule"
        >
          <Trash2 className="size-4" />
        </DestructiveButton>
      )}
    </div>
  );
}
