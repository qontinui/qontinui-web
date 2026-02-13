"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus, Trash2, Save, GitBranch } from "lucide-react";
import type {
  UIBridgeTransition,
  UIBridgeTransitionCreate,
  TransitionAction,
  SavedStateWithDetails,
} from "../_types";

interface UIBridgeTransitionEditorProps {
  transition: UIBridgeTransition | null;
  states: SavedStateWithDetails[];
  onSave: (data: UIBridgeTransitionCreate) => Promise<void>;
  onUpdate: (id: string, data: Partial<UIBridgeTransitionCreate>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

const ACTION_TYPES = ["click", "type", "select", "wait", "navigate"] as const;

export function UIBridgeTransitionEditor({
  transition,
  states,
  onSave,
  onUpdate,
  onDelete,
  onClose,
}: UIBridgeTransitionEditorProps) {
  const isEditing = !!transition;

  const [name, setName] = useState(transition?.name ?? "");
  const [fromStates, setFromStates] = useState<string[]>(transition?.from_states ?? []);
  const [activateStates, setActivateStates] = useState<string[]>(transition?.activate_states ?? []);
  const [exitStates, setExitStates] = useState<string[]>(transition?.exit_states ?? []);
  const [actions, setActions] = useState<TransitionAction[]>(transition?.actions ?? []);
  const [pathCost, setPathCost] = useState(transition?.path_cost ?? 1.0);
  const [staysVisible, setStaysVisible] = useState(transition?.stays_visible ?? false);
  const [isSaving, setIsSaving] = useState(false);

  // Reset form when transition changes
  useEffect(() => {
    if (transition) {
      setName(transition.name);
      setFromStates(transition.from_states);
      setActivateStates(transition.activate_states);
      setExitStates(transition.exit_states);
      setActions(transition.actions);
      setPathCost(transition.path_cost);
      setStaysVisible(transition.stays_visible);
    }
  }, [transition]);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const data: UIBridgeTransitionCreate = {
        name,
        from_states: fromStates,
        activate_states: activateStates,
        exit_states: exitStates,
        actions,
        path_cost: pathCost,
        stays_visible: staysVisible,
      };
      if (isEditing && transition) {
        await onUpdate(transition.id, data);
      } else {
        await onSave(data);
      }
    } finally {
      setIsSaving(false);
    }
  }, [name, fromStates, activateStates, exitStates, actions, pathCost, staysVisible, isEditing, transition, onSave, onUpdate]);

  const toggleState = (list: string[], setList: (v: string[]) => void, stateId: string) => {
    if (list.includes(stateId)) {
      setList(list.filter((s) => s !== stateId));
    } else {
      setList([...list, stateId]);
    }
  };

  const addAction = () => {
    setActions([...actions, { type: "click", target: "" }]);
  };

  const removeAction = (index: number) => {
    setActions(actions.filter((_, i) => i !== index));
  };

  const updateAction = (index: number, updates: Partial<TransitionAction>) => {
    setActions(actions.map((a, i) => (i === index ? { ...a, ...updates } : a)));
  };

  return (
    <div className="w-80 border-l border-border-primary bg-surface-primary overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-border-primary">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            {isEditing ? "Edit Transition" : "New Transition"}
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Open Settings"
            className="text-sm"
          />
        </div>

        {/* From States */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            From States (required active)
          </label>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {states.map((s) => (
              <button
                key={s.state_id}
                onClick={() => toggleState(fromStates, setFromStates, s.state_id)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  fromStates.includes(s.state_id)
                    ? "bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300"
                    : "bg-surface-secondary border-border-primary text-text-muted hover:border-blue-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Activate States */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Activate States (will become active)
          </label>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {states.map((s) => (
              <button
                key={s.state_id}
                onClick={() => toggleState(activateStates, setActivateStates, s.state_id)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  activateStates.includes(s.state_id)
                    ? "bg-green-100 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300"
                    : "bg-surface-secondary border-border-primary text-text-muted hover:border-green-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Exit States */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Exit States (will deactivate)
          </label>
          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
            {states.map((s) => (
              <button
                key={s.state_id}
                onClick={() => toggleState(exitStates, setExitStates, s.state_id)}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  exitStates.includes(s.state_id)
                    ? "bg-red-100 border-red-300 text-red-700 dark:bg-red-900/30 dark:border-red-700 dark:text-red-300"
                    : "bg-surface-secondary border-border-primary text-text-muted hover:border-red-300"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-text-muted">Actions</label>
            <Button variant="ghost" size="sm" onClick={addAction} className="h-6 px-2">
              <Plus className="size-3 mr-1" />
              <span className="text-[10px]">Add</span>
            </Button>
          </div>
          <div className="space-y-2">
            {actions.map((action, i) => (
              <div key={i} className="flex gap-1 items-start">
                <Select
                  value={action.type}
                  onValueChange={(v) => updateAction(i, { type: v as TransitionAction["type"] })}
                >
                  <SelectTrigger className="w-20 h-7 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={action.target || action.url || action.text || ""}
                  onChange={(e) => {
                    if (action.type === "navigate") {
                      updateAction(i, { url: e.target.value });
                    } else if (action.type === "type") {
                      updateAction(i, { text: e.target.value });
                    } else {
                      updateAction(i, { target: e.target.value });
                    }
                  }}
                  placeholder={
                    action.type === "navigate" ? "URL" :
                    action.type === "type" ? "Text" :
                    action.type === "wait" ? "Delay (ms)" :
                    "Element ID"
                  }
                  className="h-7 text-[10px] flex-1"
                />
                <Button variant="ghost" size="sm" onClick={() => removeAction(i)} className="h-7 w-7 p-0">
                  <Trash2 className="size-3 text-red-500" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Path Cost */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">Path Cost</label>
          <Input
            type="number"
            value={pathCost}
            onChange={(e) => setPathCost(parseFloat(e.target.value) || 1.0)}
            step={0.1}
            min={0}
            className="text-sm w-24"
          />
        </div>

        {/* Stays Visible */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={staysVisible}
            onChange={(e) => setStaysVisible(e.target.checked)}
            className="rounded"
            id="stays-visible"
          />
          <label htmlFor="stays-visible" className="text-xs text-text-muted">
            Stays visible after transition
          </label>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isSaving || !name.trim()}
            className="flex-1"
          >
            <Save className="size-3.5 mr-1.5" />
            {isSaving ? "Saving..." : isEditing ? "Update" : "Create"}
          </Button>
          {isEditing && transition && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => onDelete(transition.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
