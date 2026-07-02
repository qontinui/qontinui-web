"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  Condition,
  ConditionCreate,
  ConditionGroup,
  ConditionUpdate,
} from "../types";

interface ConditionListProps {
  groupId: string;
  conditions: Condition[];
  /** All groups (used to build the "Move to…" menu, excluding this one). */
  allGroups: ConditionGroup[];
  saving: boolean;
  onAdd: (groupId: string, data: ConditionCreate) => Promise<Condition | null>;
  onUpdate: (conditionId: string, data: ConditionUpdate) => Promise<boolean>;
  onDelete: (conditionId: string) => Promise<boolean>;
}

/**
 * The conditions within a selected group: inline-editable text, an enable
 * toggle, up/down reorder, a "Move to…" control (PATCH `group_id`), delete, and
 * an add-condition input at the bottom.
 *
 * Reorder note: the backend owns `position` semantics; up/down PATCHes this
 * item's `position` to the neighbor's current position and reloads, so the
 * server re-normalizes ordering. Conditions are rendered in the order the
 * detail endpoint returns them.
 */
export function ConditionList({
  groupId,
  conditions,
  allGroups,
  saving,
  onAdd,
  onUpdate,
  onDelete,
}: ConditionListProps) {
  const [newText, setNewText] = useState("");
  const otherGroups = allGroups.filter((g) => g.group_id !== groupId);

  const handleAdd = async () => {
    const text = newText.trim();
    if (text.length === 0 || saving) return;
    const created = await onAdd(groupId, { text });
    if (created) setNewText("");
  };

  return (
    <div className="space-y-3">
      {conditions.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          No conditions yet. Add your first check below to start building this
          regression test.
        </p>
      ) : (
        <ul className="space-y-2">
          {conditions.map((condition, index) => (
            <ConditionRow
              key={condition.condition_id}
              condition={condition}
              isFirst={index === 0}
              isLast={index === conditions.length - 1}
              prevPosition={conditions[index - 1]?.position}
              nextPosition={conditions[index + 1]?.position}
              otherGroups={otherGroups}
              saving={saving}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="Add a condition, e.g. No duplicate menu items"
          aria-label="New condition text"
        />
        <Button
          onClick={() => void handleAdd()}
          disabled={saving || newText.trim().length === 0}
        >
          <Plus className="size-4" />
          Add
        </Button>
      </div>
    </div>
  );
}

interface ConditionRowProps {
  condition: Condition;
  isFirst: boolean;
  isLast: boolean;
  prevPosition: number | undefined;
  nextPosition: number | undefined;
  otherGroups: ConditionGroup[];
  saving: boolean;
  onUpdate: (conditionId: string, data: ConditionUpdate) => Promise<boolean>;
  onDelete: (conditionId: string) => Promise<boolean>;
}

function ConditionRow({
  condition,
  isFirst,
  isLast,
  prevPosition,
  nextPosition,
  otherGroups,
  saving,
  onUpdate,
  onDelete,
}: ConditionRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(condition.text);

  const beginEdit = () => {
    setDraft(condition.text);
    setEditing(true);
  };

  const saveEdit = async () => {
    const text = draft.trim();
    if (text.length === 0 || text === condition.text) {
      setEditing(false);
      return;
    }
    const ok = await onUpdate(condition.condition_id, { text });
    if (ok) setEditing(false);
  };

  return (
    <li className="group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {/* Reorder controls */}
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          disabled={isFirst || saving || prevPosition === undefined}
          onClick={() =>
            prevPosition !== undefined &&
            void onUpdate(condition.condition_id, { position: prevPosition })
          }
          aria-label="Move up"
          title="Move up"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          type="button"
          className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          disabled={isLast || saving || nextPosition === undefined}
          onClick={() =>
            nextPosition !== undefined &&
            void onUpdate(condition.condition_id, { position: nextPosition })
          }
          aria-label="Move down"
          title="Move down"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {/* Text (inline-editable) */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              autoFocus
              aria-label="Condition text"
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              onClick={() => void saveEdit()}
              disabled={saving}
              title="Save"
            >
              <Check className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              onClick={() => setEditing(false)}
              title="Cancel"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={beginEdit}
            className="flex w-full items-center gap-2 text-left"
            title="Click to edit"
          >
            <span
              className={
                condition.enabled
                  ? "truncate text-sm"
                  : "truncate text-sm text-muted-foreground line-through"
              }
            >
              {condition.text}
            </span>
            <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </div>

      {!editing && (
        <>
          {/* Enable toggle */}
          <Switch
            checked={condition.enabled}
            disabled={saving}
            onCheckedChange={(enabled) =>
              void onUpdate(condition.condition_id, { enabled })
            }
            aria-label="Enabled"
          />

          {/* Move to another group */}
          {otherGroups.length > 0 && (
            <Select
              value=""
              onValueChange={(targetGroupId) =>
                void onUpdate(condition.condition_id, {
                  group_id: targetGroupId,
                })
              }
              disabled={saving}
            >
              <SelectTrigger
                className="h-8 w-8 justify-center p-0 [&>svg:last-child]:hidden"
                aria-label="Move to another group"
                title="Move to another group"
              >
                <ArrowRightLeft className="size-4 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent>
                {otherGroups.map((g) => (
                  <SelectItem key={g.group_id} value={g.group_id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Delete */}
          <DestructiveButton
            size="sm"
            className="h-8 w-8 shrink-0 p-0"
            onClick={() => void onDelete(condition.condition_id)}
            disabled={saving}
            title="Delete condition"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </DestructiveButton>
        </>
      )}
    </li>
  );
}
