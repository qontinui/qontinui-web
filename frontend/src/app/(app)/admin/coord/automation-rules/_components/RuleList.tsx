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
import { MessageSquare, Pencil, Plus, Terminal, Trash2 } from "lucide-react";
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
  }
  return "";
}

export function RuleList() {
  const { rules, loading, saving, createRule, updateRule, deleteRule } =
    useAutomationRules();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PolicyRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyRow | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} data-testid="new-rule">
          <Plus className="size-4" />
          New Rule
        </Button>
      </div>

      {rules.length === 0 ? (
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
              onToggle={(enabled) =>
                void updateRule(rule.policy_id, { enabled })
              }
              onEdit={() => openEdit(rule)}
              onDelete={() => setDeleteTarget(rule)}
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
      />

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
}

function RuleRow({ rule, saving, onToggle, onEdit, onDelete }: RuleRowProps) {
  const isTerminal = rule.kind === "terminal_auto_response";
  const KindIcon = isTerminal ? Terminal : MessageSquare;
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
      <KindIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.name}</span>
          <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {isTerminal ? "Terminal" : "Question"}
          </span>
        </div>
        <code className="block truncate text-xs text-muted-foreground">
          {conditionSummary(rule)} {actionSummary(rule)}
        </code>
      </div>

      <Switch
        checked={rule.enabled}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label="Enabled"
      />

      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title="Edit rule"
      >
        <Pencil className="size-4" />
      </Button>

      <DestructiveButton
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onDelete}
        title="Delete rule"
      >
        <Trash2 className="size-4" />
      </DestructiveButton>
    </div>
  );
}
