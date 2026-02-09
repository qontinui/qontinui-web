"use client";

import { useState, useMemo } from "react";
import { ChevronRight, Plus, Trash2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  UIBridgeTransition,
  UIBridgeState,
} from "@/lib/state-machine-builder/types";

interface TransitionListPanelProps {
  transitions: UIBridgeTransition[];
  states: UIBridgeState[];
  selectedTransitionId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}

export function TransitionListPanel({
  transitions,
  states,
  selectedTransitionId,
  onSelect,
  onAdd,
  onDelete,
}: TransitionListPanelProps) {
  const [open, setOpen] = useState(true);

  const stateNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of states) {
      map.set(s.id, s.name);
    }
    return map;
  }, [states]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* Header */}
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 w-full px-3 py-2.5 bg-surface-canvas border-y border-border-subtle hover:bg-surface-raised/50 transition-colors"
        >
          <ChevronRight
            className={`h-4 w-4 text-text-muted transition-transform duration-200 ${
              open ? "rotate-90" : ""
            }`}
          />
          <span className="text-sm font-medium text-text-primary">
            Transitions
          </span>
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] px-1.5 py-0"
          >
            {transitions.length}
          </Badge>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {transitions.length === 0 && (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-text-muted">
              No transitions yet. Add one to connect states.
            </p>
          </div>
        )}

        {transitions.map((transition) => {
          const isSelected = transition.id === selectedTransitionId;
          const fromName = stateNameMap.get(transition.from) ?? transition.from;
          const toName = stateNameMap.get(transition.to) ?? transition.to;

          return (
            <button
              key={transition.id}
              type="button"
              onClick={() => onSelect(transition.id)}
              className={`
                group w-full text-left px-3 py-2 border-b border-border-subtle
                flex items-center gap-2 transition-colors
                hover:bg-surface-raised/50
                ${
                  isSelected
                    ? "bg-[var(--brand-secondary)]/20 border-l-2 border-l-[var(--brand-secondary)]"
                    : "border-l-2 border-l-transparent"
                }
              `}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="truncate text-text-primary font-medium">
                    {fromName}
                  </span>
                  <ArrowRight className="h-3 w-3 text-text-muted shrink-0" />
                  <span className="truncate text-text-primary font-medium">
                    {toName}
                  </span>
                </div>
                <Badge
                  variant="outline"
                  className="mt-1 text-[10px] px-1.5 py-0"
                >
                  {transition.action.type}
                </Badge>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(transition.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </button>
          );
        })}

        {/* Add Button */}
        <div className="p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onAdd}
          >
            <Plus className="h-4 w-4" />
            Add Transition
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
