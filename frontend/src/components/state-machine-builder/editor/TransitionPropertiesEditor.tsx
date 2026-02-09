"use client";

import { useCallback } from "react";
import { X, Trash2, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  UIBridgeTransition,
  UIBridgeState,
  BuilderAction,
} from "@/lib/state-machine-builder/types";

interface TransitionPropertiesEditorProps {
  transition: UIBridgeTransition;
  states: UIBridgeState[];
  dispatch: React.Dispatch<BuilderAction>;
}

export function TransitionPropertiesEditor({
  transition,
  states,
  dispatch,
}: TransitionPropertiesEditorProps) {
  const update = useCallback(
    (updates: Partial<UIBridgeTransition>) => {
      dispatch({ type: "UPDATE_TRANSITION", id: transition.id, updates });
    },
    [dispatch, transition.id]
  );

  const handleClose = useCallback(() => {
    dispatch({ type: "SELECT_TRANSITION", id: null });
  }, [dispatch]);

  const handleDelete = useCallback(() => {
    dispatch({ type: "DELETE_TRANSITION", id: transition.id });
  }, [dispatch, transition.id]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <ArrowRight className="h-4 w-4 text-text-muted shrink-0" />
        <h3 className="text-sm font-semibold text-text-primary truncate flex-1">
          Transition
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* From State */}
        <div className="space-y-1.5">
          <Label className="text-xs text-text-secondary">From State</Label>
          <Select
            value={transition.from}
            onValueChange={(value) => update({ from: value })}
          >
            <SelectTrigger className="h-8 text-sm w-full">
              <SelectValue placeholder="Select state..." />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* To State */}
        <div className="space-y-1.5">
          <Label className="text-xs text-text-secondary">To State</Label>
          <Select
            value={transition.to}
            onValueChange={(value) => update({ to: value })}
          >
            <SelectTrigger className="h-8 text-sm w-full">
              <SelectValue placeholder="Select state..." />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Action Type */}
        <div className="space-y-1.5">
          <Label
            htmlFor="transition-action-type"
            className="text-xs text-text-secondary"
          >
            Action Type
          </Label>
          <Input
            id="transition-action-type"
            value={transition.action.type}
            onChange={(e) =>
              update({
                action: { ...transition.action, type: e.target.value },
              })
            }
            placeholder="e.g. click, navigate, type"
            className="h-8 text-sm"
          />
        </div>

        {/* Action Element */}
        <div className="space-y-1.5">
          <Label
            htmlFor="transition-action-element"
            className="text-xs text-text-secondary"
          >
            Action Element
            <span className="text-text-muted ml-1">(optional)</span>
          </Label>
          <Input
            id="transition-action-element"
            value={transition.action.element ?? ""}
            onChange={(e) =>
              update({
                action: {
                  ...transition.action,
                  element: e.target.value || undefined,
                },
              })
            }
            placeholder="Element identifier"
            className="h-8 text-sm"
          />
        </div>

        <Separator />

        {/* Read-only: Count */}
        {transition.count != null && (
          <div className="space-y-0.5">
            <span className="text-xs text-text-muted">Observation Count</span>
            <p className="text-sm font-medium text-text-primary">
              {transition.count}
            </p>
          </div>
        )}

        {/* Delete */}
        <div className="pt-2">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete Transition
          </Button>
        </div>
      </div>
    </div>
  );
}
