"use client";

import React, { useState } from "react";
import { Transition, State } from "@/contexts/automation-context/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  RefreshCw,
  XCircle,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { TransitionValidation } from "./types";

interface ValidationPanelProps {
  validation: TransitionValidation;
  states: State[];
  transitions: Transition[];
  onIssueClick: (issueType: string, itemId: string) => void;
}

export function ValidationPanel({
  validation,
  states,
  transitions,
  onIssueClick,
}: ValidationPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  const totalIssues =
    validation.circular.length +
    validation.brokenStateReferences.length +
    validation.missingWorkflows.length +
    validation.unreachableStates.length +
    validation.deadEndStates.length;

  if (totalIssues === 0) {
    return null;
  }

  return (
    <Card className="border-gray-700 bg-[#27272A]">
      <CardHeader className="cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <CardTitle className="text-sm">
              Validation Issues ({totalIssues})
            </CardTitle>
          </div>
          {isOpen ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="space-y-3">
          {validation.circular.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-red-400">
                <RefreshCw className="w-3 h-3" />
                <span>Circular Transitions ({validation.circular.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.circular.map((id) => {
                  const transition = transitions.find((t) => t.id === id);
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block w-full text-left"
                      onClick={() => onIssueClick("circular", id)}
                    >
                      {transition?.type === "OutgoingTransition"
                        ? `${
                            states.find((s) => s.id === transition.fromState)
                              ?.name
                          } → ${transition.activateStates
                            .map(
                              (sid) => states.find((s) => s.id === sid)?.name
                            )
                            .join(", ")}`
                        : "Unknown transition"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {validation.brokenStateReferences.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-yellow-400">
                <AlertTriangle className="w-3 h-3" />
                <span>
                  Broken References ({validation.brokenStateReferences.length})
                </span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.brokenStateReferences.map((id) => (
                  <button
                    key={id}
                    className="text-xs text-gray-400 hover:text-white block"
                    onClick={() => onIssueClick("broken", id)}
                  >
                    Transition {id.slice(0, 8)}...
                  </button>
                ))}
              </div>
            </div>
          )}

          {validation.unreachableStates.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-orange-400">
                <XCircle className="w-3 h-3" />
                <span>
                  Unreachable States ({validation.unreachableStates.length})
                </span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.unreachableStates.map((id) => {
                  const state = states.find((s) => s.id === id);
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block"
                      onClick={() => onIssueClick("unreachable", id)}
                    >
                      {state?.name || "Unknown"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {validation.deadEndStates.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                <Eye className="w-3 h-3" />
                <span>Dead-end States ({validation.deadEndStates.length})</span>
              </div>
              <div className="space-y-1 ml-5">
                {validation.deadEndStates.map((id) => {
                  const state = states.find((s) => s.id === id);
                  return (
                    <button
                      key={id}
                      className="text-xs text-gray-400 hover:text-white block"
                      onClick={() => onIssueClick("deadend", id)}
                    >
                      {state?.name || "Unknown"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
