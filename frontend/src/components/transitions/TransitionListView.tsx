"use client";

import React, { useState, useMemo } from "react";
import { Transition, State } from "@/contexts/automation-context/types";
import { Workflow } from "@/lib/action-schema/action-types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  Trash2,
  AlertTriangle,
  RefreshCw,
  Zap,
  Clock,
  ChevronDown,
} from "lucide-react";
import { TransitionValidation, COLORS } from "./types";

interface TransitionListViewProps {
  transitions: Transition[];
  states: State[];
  workflows: Workflow[];
  validation: TransitionValidation;
  selectedTransitions: Set<string>;
  onTransitionSelect: (id: string, selected: boolean) => void;
  onTransitionClick: (transition: Transition) => void;
  onTransitionDelete: (id: string) => void;
}

export function TransitionListView({
  transitions,
  states,
  workflows: _workflows,
  validation,
  selectedTransitions,
  onTransitionSelect,
  onTransitionClick,
  onTransitionDelete,
}: TransitionListViewProps) {
  const [sortBy, setSortBy] = useState<
    "fromState" | "toState" | "type" | "modified"
  >("fromState");
  const [groupBy, setGroupBy] = useState<
    "none" | "fromState" | "toState" | "type"
  >("none");

  const sortedTransitions = useMemo(() => {
    return [...transitions].sort((a, b) => {
      if (
        sortBy === "fromState" &&
        a.type === "OutgoingTransition" &&
        b.type === "OutgoingTransition"
      ) {
        const aState = states.find((s) => s.id === a.fromState)?.name || "";
        const bState = states.find((s) => s.id === b.fromState)?.name || "";
        return aState.localeCompare(bState);
      }
      if (sortBy === "toState") {
        const aState =
          a.type === "IncomingTransition"
            ? states.find((s) => s.id === a.toState)?.name || ""
            : "";
        const bState =
          b.type === "IncomingTransition"
            ? states.find((s) => s.id === b.toState)?.name || ""
            : "";
        return aState.localeCompare(bState);
      }
      if (sortBy === "type") {
        return a.type.localeCompare(b.type);
      }
      return 0;
    });
  }, [transitions, sortBy, states]);

  const groupedTransitions = useMemo(() => {
    if (groupBy === "none") {
      return { "": sortedTransitions };
    }

    const groups: Record<string, Transition[]> = {};

    sortedTransitions.forEach((t) => {
      let groupKey = "";

      if (groupBy === "fromState" && t.type === "OutgoingTransition") {
        groupKey = states.find((s) => s.id === t.fromState)?.name || "Unknown";
      } else if (groupBy === "toState" && t.type === "IncomingTransition") {
        groupKey = states.find((s) => s.id === t.toState)?.name || "Unknown";
      } else if (groupBy === "type") {
        groupKey = t.type;
      } else {
        groupKey = "Other";
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey]!.push(t);
    });

    return groups;
  }, [sortedTransitions, groupBy, states]);

  const getTransitionIcon = (transition: Transition) => {
    if (validation.circular.includes(transition.id)) {
      return <RefreshCw className="w-4 h-4 text-red-400" />;
    }
    if (validation.brokenStateReferences.includes(transition.id)) {
      return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
    }
    if (transition.workflows.length > 0) {
      return <Zap className="w-4 h-4 text-[#00D9FF]" />;
    }
    return <ArrowRight className="w-4 h-4 text-gray-400" />;
  };

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Sort and Group Controls */}
      <div className="flex gap-2">
        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
          <SelectTrigger className="w-[150px] bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fromState">Sort by From</SelectItem>
            <SelectItem value="toState">Sort by To</SelectItem>
            <SelectItem value="type">Sort by Type</SelectItem>
            <SelectItem value="modified">Sort by Modified</SelectItem>
          </SelectContent>
        </Select>

        <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
          <SelectTrigger className="w-[150px] bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="fromState">Group by From</SelectItem>
            <SelectItem value="toState">Group by To</SelectItem>
            <SelectItem value="type">Group by Type</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Transition List */}
      <ScrollArea className="flex-1">
        <div className="space-y-4">
          {Object.entries(groupedTransitions).map(
            ([groupName, groupTransitions]) => (
              <div key={groupName}>
                {groupBy !== "none" && (
                  <div className="flex items-center gap-2 mb-2">
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-medium text-gray-300">
                      {groupName} ({groupTransitions.length})
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  {groupTransitions.map((transition) => (
                    <Card
                      key={transition.id}
                      className="border-gray-700 bg-[#27272A] hover:border-[#00D9FF] transition-colors cursor-pointer"
                      onClick={() => onTransitionClick(transition)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedTransitions.has(transition.id)}
                            onCheckedChange={(checked) =>
                              onTransitionSelect(transition.id, !!checked)
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                          {getTransitionIcon(transition)}
                          <div className="flex-1 min-w-0">
                            {transition.type === "OutgoingTransition" ? (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium truncate">
                                  {states.find(
                                    (s) => s.id === transition.fromState
                                  )?.name || "Unknown"}
                                </span>
                                <ArrowRight className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">
                                  {transition.activateStates
                                    .map(
                                      (id) =>
                                        states.find((s) => s.id === id)?.name ||
                                        "Unknown"
                                    )
                                    .join(", ")}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-gray-400">Entry:</span>
                                <span className="font-medium">
                                  {states.find(
                                    (s) => s.id === transition.toState
                                  )?.name || "Unknown"}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              <Badge
                                variant="outline"
                                className="text-xs"
                                style={{
                                  borderColor:
                                    transition.type === "OutgoingTransition"
                                      ? COLORS.success
                                      : COLORS.primary,
                                }}
                              >
                                {transition.type === "OutgoingTransition"
                                  ? "Outgoing"
                                  : "Incoming"}
                              </Badge>
                              {transition.workflows.length > 0 && (
                                <Badge className="text-xs bg-[#00D9FF]/20 text-[#00D9FF]">
                                  {transition.workflows.length} workflow
                                  {transition.workflows.length !== 1 ? "s" : ""}
                                </Badge>
                              )}
                              {transition.timeout && (
                                <span className="text-xs text-gray-400 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {transition.timeout}ms
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                            onClick={(e) => {
                              e.stopPropagation();
                              onTransitionDelete(transition.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
