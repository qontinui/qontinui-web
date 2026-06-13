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
  ChevronUp,
  ChevronDown,
  Lock,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutoResponseRules } from "../_hooks/useAutoResponseRules";
import { RuleEditorDialog } from "./RuleEditorDialog";
import type { AutoResponseRule } from "../types";

interface RuleListProps {
  orgId: string;
}

export function RuleList({ orgId }: RuleListProps) {
  const {
    rules,
    loading,
    saving,
    createRule,
    updateRule,
    deleteRule,
    reorderRules,
  } = useAutoResponseRules(orgId);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutoResponseRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutoResponseRule | null>(
    null
  );

  /** Swap two rows and persist the new ordering via the reorder endpoint. */
  const moveBy = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const moved = next[index];
    const other = next[target];
    if (!moved || !other) return;
    next[index] = other;
    next[target] = moved;
    void reorderRules(next.map((r) => r.id));
  };

  const openCreate = () => {
    setEditingRule(null);
    setEditorOpen(true);
  };

  const openEdit = (rule: AutoResponseRule) => {
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
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          New Rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No auto-response rules yet.
          </p>
          <Button variant="outline" className="mt-3" onClick={openCreate}>
            <Plus className="size-4" />
            Create your first rule
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, index) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              saving={saving}
              isFirst={index === 0}
              isLast={index === rules.length - 1}
              onMoveUp={() => moveBy(index, -1)}
              onMoveDown={() => moveBy(index, 1)}
              onToggle={(enabled) => void updateRule(rule.id, { enabled })}
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
                if (deleteTarget) void deleteRule(deleteTarget.id);
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
  rule: AutoResponseRule;
  saving: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function RuleRow({
  rule,
  saving,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onToggle,
  onEdit,
  onDelete,
}: RuleRowProps) {
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3"
      )}
    >
      {/* Up / down reorder */}
      <div className="flex shrink-0 flex-col">
        <Button
          variant="ghost"
          size="sm"
          className="h-4 w-5 p-0"
          disabled={isFirst || saving}
          onClick={onMoveUp}
          title="Move up"
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-4 w-5 p-0"
          disabled={isLast || saving}
          onClick={onMoveDown}
          title="Move down"
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>

      {/* Name + pattern */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{rule.name}</span>
          {rule.is_built_in && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <Lock className="size-2.5" />
              Built-in
            </span>
          )}
        </div>
        <code className="block truncate text-xs text-muted-foreground">
          {rule.pattern}
        </code>
      </div>

      {/* Enable toggle */}
      <Switch
        checked={rule.enabled}
        disabled={saving}
        onCheckedChange={onToggle}
        aria-label="Enabled"
      />

      {/* Edit */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        onClick={onEdit}
        title="Edit rule"
      >
        <Pencil className="size-4" />
      </Button>

      {/* Delete — hidden (lock shown) for built-in rules */}
      {rule.is_built_in ? (
        <span
          className="flex h-8 w-8 items-center justify-center text-muted-foreground"
          title="Built-in rules cannot be deleted"
        >
          <Lock className="size-4" />
        </span>
      ) : (
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
