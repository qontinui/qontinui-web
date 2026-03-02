"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { State } from "../types";

interface StateListSectionProps {
  label: string;
  dialogTitle: string;
  dialogDescription: string;
  stateType: "activate" | "deactivate";
  stateIds: string[];
  states: State[];
  availableStates: State[];
  dialogOpen: boolean;
  selectedStateType: "activate" | "deactivate";
  onDialogOpenChange: (open: boolean) => void;
  onSelectStateType: (type: "activate" | "deactivate") => void;
  onAddState: (stateId: string, type: "activate" | "deactivate") => void;
  onRemoveState: (stateId: string, type: "activate" | "deactivate") => void;
  emptyMessage: string;
}

export function StateListSection({
  label,
  dialogTitle,
  dialogDescription,
  stateType,
  stateIds,
  states,
  availableStates,
  dialogOpen,
  selectedStateType,
  onDialogOpenChange,
  onSelectStateType,
  onAddState,
  onRemoveState,
  emptyMessage,
}: StateListSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-muted">{label}</Label>
        <Dialog
          open={dialogOpen && selectedStateType === stateType}
          onOpenChange={onDialogOpenChange}
        >
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-text-muted hover:text-text-secondary"
              onClick={() => {
                onSelectStateType(stateType);
                onDialogOpenChange(true);
              }}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-surface-raised border-border-default">
            <DialogHeader>
              <DialogTitle className="text-brand-primary">
                {dialogTitle}
              </DialogTitle>
              <DialogDescription className="text-text-muted text-sm">
                {dialogDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {availableStates.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">
                  No available states
                </p>
              ) : (
                availableStates.map((state) => (
                  <Button
                    key={state.id}
                    variant="outline"
                    className="w-full justify-start bg-transparent border-border-default hover:border-brand-primary hover:text-brand-primary"
                    onClick={() => onAddState(state.id, stateType)}
                  >
                    {state.name}
                  </Button>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {!Array.isArray(stateIds) || stateIds.length === 0 ? (
        <div className="p-2 bg-surface-overlay rounded text-sm text-text-muted text-center">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-1">
          {stateIds.map((stateId) => (
            <div
              key={stateId}
              className="flex items-center justify-between p-2 bg-surface-overlay rounded"
            >
              <span className="text-sm">
                {states.find((s) => s.id === stateId)?.name || "Unknown State"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                onClick={() => onRemoveState(stateId, stateType)}
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
