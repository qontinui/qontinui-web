"use client";

import { useState, useCallback } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
} from "@/lib/state-machine-builder/types";

interface AddTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (transition: UIBridgeTransition) => void;
  states: UIBridgeState[];
}

export function AddTransitionDialog({
  open,
  onOpenChange,
  onAdd,
  states,
}: AddTransitionDialogProps) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [actionType, setActionType] = useState("click");

  const isValid =
    fromId.length > 0 &&
    toId.length > 0 &&
    fromId !== toId &&
    actionType.trim().length > 0;

  const resetForm = useCallback(() => {
    setFromId("");
    setToId("");
    setActionType("click");
  }, []);

  const handleAdd = useCallback(() => {
    if (!isValid) return;

    const transition: UIBridgeTransition = {
      id: `transition-${Date.now()}`,
      from: fromId,
      to: toId,
      action: {
        type: actionType.trim(),
      },
    };

    onAdd(transition);
    resetForm();
    onOpenChange(false);
  }, [isValid, fromId, toId, actionType, onAdd, resetForm, onOpenChange]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  const validationMessage =
    fromId && toId && fromId === toId
      ? "From and To states must be different."
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onSubmit={handleAdd}>
        <DialogHeader>
          <DialogTitle>Add Transition</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* From State */}
          <div className="space-y-1.5">
            <Label className="text-xs text-text-secondary">
              From State <span className="text-destructive">*</span>
            </Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue placeholder="Select source state..." />
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
            <Label className="text-xs text-text-secondary">
              To State <span className="text-destructive">*</span>
            </Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue placeholder="Select target state..." />
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

          {validationMessage && (
            <p className="text-xs text-destructive">{validationMessage}</p>
          )}

          {/* Action Type */}
          <div className="space-y-1.5">
            <Label
              htmlFor="new-transition-action"
              className="text-xs text-text-secondary"
            >
              Action Type <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-transition-action"
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              placeholder="e.g. click, navigate, type"
              className="h-8 text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleAdd}
            disabled={!isValid}
          >
            <Plus className="h-4 w-4" />
            Add Transition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
