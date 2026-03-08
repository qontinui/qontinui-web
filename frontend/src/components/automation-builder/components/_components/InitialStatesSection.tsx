import React from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, Play, AlertCircle } from "lucide-react";
import type { State } from "@/contexts/automation-context/types";

interface InitialStatesSectionProps {
  states: State[];
  initialStateIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (stateId: string, checked: boolean) => void;
  onResetToDefaults: () => void;
}

export function InitialStatesSection({
  states,
  initialStateIds,
  open,
  onOpenChange,
  onToggle,
  onResetToDefaults,
}: InitialStatesSectionProps) {
  return (
    <div className="mt-6 pt-6 border-t border-border-subtle">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-surface-canvas/50 rounded-md px-2 transition-colors">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-brand-success" />
            <span className="text-sm font-medium text-text-muted">
              Initial States
            </span>
            {initialStateIds.length > 0 ? (
              <span className="text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                {initialStateIds.length} custom
              </span>
            ) : (
              <span className="text-xs text-text-muted bg-text-muted/10 px-1.5 py-0.5 rounded">
                {states.filter((s) => s.initial).length} defaults
              </span>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
              open ? "rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="bg-surface-canvas/30 border border-border-subtle rounded-lg p-3">
            <InheritanceIndicator
              states={states}
              initialStateIds={initialStateIds}
              onResetToDefaults={onResetToDefaults}
            />

            <p className="text-xs text-text-muted mb-3">
              Select which states should be active when this workflow starts.
              States marked as &quot;Initial&quot; in the State Machine are used
              by default.
            </p>
            {states.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-amber-500">
                <AlertCircle className="h-4 w-4" />
                <span>No states defined in this project</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {states.map((state) => {
                  const isDefaultInitial = state.initial === true;
                  const isSelected =
                    initialStateIds.length > 0
                      ? initialStateIds.includes(state.id)
                      : isDefaultInitial;

                  return (
                    <div
                      key={state.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-surface-raised/50 cursor-pointer transition-colors"
                      onClick={() => onToggle(state.id, !isSelected)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          onToggle(state.id, checked === true)
                        }
                        className="border-border-default data-[state=checked]:bg-brand-success data-[state=checked]:border-brand-success"
                      />
                      <span className="text-sm text-text-muted flex-1">
                        {state.name}
                      </span>
                      {isDefaultInitial && (
                        <span className="text-xs text-text-muted bg-surface-raised/50 px-1.5 py-0.5 rounded">
                          default
                        </span>
                      )}
                      {state.description && (
                        <span className="text-xs text-text-muted truncate max-w-[100px]">
                          {state.description}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function InheritanceIndicator({
  states,
  initialStateIds,
  onResetToDefaults,
}: {
  states: State[];
  initialStateIds: string[];
  onResetToDefaults: () => void;
}) {
  if (initialStateIds.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted mb-3 p-2 bg-surface-raised/50 rounded">
        <Play className="h-3 w-3" />
        <span>
          Using {states.filter((s) => s.initial).length} default initial states
          from State Machine
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-xs mb-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded">
      <div className="flex items-center gap-2 text-amber-500">
        <AlertCircle className="h-3 w-3" />
        <span>
          Overriding defaults with {initialStateIds.length} custom state
          {initialStateIds.length !== 1 ? "s" : ""}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-amber-500 hover:text-amber-400 hover:bg-amber-500/10"
        onClick={onResetToDefaults}
      >
        Reset to defaults
      </Button>
    </div>
  );
}
