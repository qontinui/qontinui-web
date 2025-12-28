"use client";

/**
 * Transition List Component
 *
 * Displays a list of transitions for selection in the visualization panel.
 */

import React, { useMemo, useState } from "react";
import type {
  Transition,
  OutgoingTransition,
  IncomingTransition,
  State,
} from "@/contexts/automation-context/types";
import type { Workflow } from "@/lib/action-schema/action-types";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowRight,
  ArrowDown,
  Workflow as WorkflowIcon,
  Eye,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TransitionListProps {
  /** All transitions in the project */
  transitions: Transition[];
  /** All states for name resolution */
  states: State[];
  /** All workflows for action counting */
  workflows: Workflow[];
  /** Currently selected transition */
  selectedTransition: Transition | null;
  /** Callback when a transition is selected */
  onTransitionSelect: (transition: Transition | null) => void;
}

export function TransitionList({
  transitions,
  states,
  workflows,
  selectedTransition,
  onTransitionSelect,
}: TransitionListProps) {
  const [originStateFilter, setOriginStateFilter] = useState<string>("all");
  const [targetStateFilter, setTargetStateFilter] = useState<string>("all");

  // Resolve state ID to name
  const getStateName = (stateId: string): string => {
    const state = states.find((s) => s.id === stateId);
    return state?.name || stateId;
  };

  // Get workflow action count
  const getActionCount = (workflowIds: string[]): number => {
    return workflowIds.reduce((count, wfId) => {
      const workflow = workflows.find((w) => w.id === wfId);
      return count + (workflow?.actions?.length || 0);
    }, 0);
  };

  // Get unique origin states from transitions
  const originStates = useMemo(() => {
    const stateIds = new Set<string>();
    transitions.forEach((t) => {
      if (t.type === "OutgoingTransition") {
        stateIds.add((t as OutgoingTransition).fromState);
      }
    });
    return states.filter((s) => stateIds.has(s.id));
  }, [transitions, states]);

  // Get unique target states from transitions
  const targetStates = useMemo(() => {
    const stateIds = new Set<string>();
    transitions.forEach((t) => {
      if (t.type === "OutgoingTransition") {
        (t as OutgoingTransition).activateStates.forEach((id) =>
          stateIds.add(id)
        );
      } else {
        stateIds.add((t as IncomingTransition).toState);
      }
    });
    return states.filter((s) => stateIds.has(s.id));
  }, [transitions, states]);

  // Filter transitions by dropdowns
  const filteredTransitions = useMemo(() => {
    return transitions.filter((t) => {
      // Filter by origin state
      if (originStateFilter !== "all") {
        if (t.type === "OutgoingTransition") {
          if ((t as OutgoingTransition).fromState !== originStateFilter) {
            return false;
          }
        } else {
          // Incoming transitions don't have an origin state
          return false;
        }
      }

      // Filter by target state
      if (targetStateFilter !== "all") {
        if (t.type === "OutgoingTransition") {
          const outgoing = t as OutgoingTransition;
          if (!outgoing.activateStates.includes(targetStateFilter)) {
            return false;
          }
        } else {
          const incoming = t as IncomingTransition;
          if (incoming.toState !== targetStateFilter) {
            return false;
          }
        }
      }

      return true;
    });
  }, [transitions, originStateFilter, targetStateFilter]);

  // Group transitions by type
  const { outgoingTransitions, incomingTransitions } = useMemo(() => {
    const outgoing: OutgoingTransition[] = [];
    const incoming: IncomingTransition[] = [];

    filteredTransitions.forEach((t) => {
      if (t.type === "OutgoingTransition") {
        outgoing.push(t as OutgoingTransition);
      } else {
        incoming.push(t as IncomingTransition);
      }
    });

    return { outgoingTransitions: outgoing, incomingTransitions: incoming };
  }, [filteredTransitions]);

  const renderOutgoingTransition = (transition: OutgoingTransition) => {
    const isSelected = selectedTransition?.id === transition.id;
    const fromName = getStateName(transition.fromState);
    const toNames = transition.activateStates.map((id) => getStateName(id));
    const actionCount = getActionCount(transition.workflows);

    return (
      <div
        key={transition.id}
        className={cn(
          "p-3 rounded-lg border cursor-pointer transition-colors",
          isSelected
            ? "bg-primary/10 border-primary"
            : "hover:bg-muted/50 border-transparent hover:border-muted-foreground/20"
        )}
        onClick={() => onTransitionSelect(isSelected ? null : transition)}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <ArrowRight className="h-4 w-4 text-fuchsia-500 flex-shrink-0" />
          <span className="font-medium text-sm truncate">{fromName}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground truncate">
            {toNames.length === 1 ? toNames[0] : `${toNames.length} states`}
          </span>
        </div>

        {/* Details */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-5 text-xs">
            <WorkflowIcon className="h-3 w-3 mr-1" />
            {transition.workflows.length} workflow
            {transition.workflows.length !== 1 ? "s" : ""}
          </Badge>
          {actionCount > 0 && (
            <Badge variant="outline" className="h-5 text-xs">
              {actionCount} action{actionCount !== 1 ? "s" : ""}
            </Badge>
          )}
          {transition.staysVisible && (
            <Badge variant="secondary" className="h-5 text-xs">
              <Eye className="h-3 w-3 mr-1" />
              stays
            </Badge>
          )}
        </div>

        {/* Target states expansion */}
        {toNames.length > 1 && (
          <div className="mt-2 pl-6 text-xs text-muted-foreground">
            <div className="flex items-center gap-1 mb-1">
              <Layers className="h-3 w-3" />
              Activates:
            </div>
            <ul className="space-y-0.5 ml-4">
              {toNames.map((name, i) => (
                <li key={i} className="text-foreground">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderIncomingTransition = (transition: IncomingTransition) => {
    const isSelected = selectedTransition?.id === transition.id;
    const toName = getStateName(transition.toState);
    const actionCount = getActionCount(transition.workflows);

    return (
      <div
        key={transition.id}
        className={cn(
          "p-3 rounded-lg border cursor-pointer transition-colors",
          isSelected
            ? "bg-primary/10 border-primary"
            : "hover:bg-muted/50 border-transparent hover:border-muted-foreground/20"
        )}
        onClick={() => onTransitionSelect(isSelected ? null : transition)}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <ArrowDown className="h-4 w-4 text-green-500 flex-shrink-0" />
          <span className="font-medium text-sm">→ {toName}</span>
        </div>

        {/* Details */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="h-5 text-xs">
            <WorkflowIcon className="h-3 w-3 mr-1" />
            {transition.workflows.length} workflow
            {transition.workflows.length !== 1 ? "s" : ""}
          </Badge>
          {actionCount > 0 && (
            <Badge variant="outline" className="h-5 text-xs">
              {actionCount} action{actionCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Dropdown Filters */}
      <div className="space-y-3 mb-4">
        {/* Origin State Filter */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Origin State</Label>
          <Select
            value={originStateFilter}
            onValueChange={setOriginStateFilter}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All origin states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All origin states</SelectItem>
              {originStates.map((state) => (
                <SelectItem key={state.id} value={state.id}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Target State Filter */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Target State</Label>
          <Select
            value={targetStateFilter}
            onValueChange={setTargetStateFilter}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All target states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All target states</SelectItem>
              {targetStates.map((state) => (
                <SelectItem key={state.id} value={state.id}>
                  {state.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Transition list */}
      <ScrollArea className="flex-1">
        {filteredTransitions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ArrowRight className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">
              {originStateFilter !== "all" || targetStateFilter !== "all"
                ? "No matching transitions"
                : "No transitions defined"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Outgoing transitions */}
            {outgoingTransitions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <ArrowRight className="h-3 w-3 text-fuchsia-500" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Outgoing Transitions
                  </span>
                  <Badge variant="outline" className="h-4 text-xs">
                    {outgoingTransitions.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {outgoingTransitions.map(renderOutgoingTransition)}
                </div>
              </div>
            )}

            {/* Incoming transitions */}
            {incomingTransitions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <ArrowDown className="h-3 w-3 text-green-500" />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Incoming Transitions
                  </span>
                  <Badge variant="outline" className="h-4 text-xs">
                    {incomingTransitions.length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {incomingTransitions.map(renderIncomingTransition)}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export default TransitionList;
