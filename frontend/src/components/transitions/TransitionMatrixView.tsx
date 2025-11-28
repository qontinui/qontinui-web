"use client";

import React from "react";
import {
  Transition,
  State,
  OutgoingTransition,
} from "@/contexts/automation-context/types";
import { Badge } from "@/components/ui/badge";
import { TransitionValidation, COLORS } from "./types";

interface TransitionMatrixViewProps {
  transitions: Transition[];
  states: State[];
  validation: TransitionValidation;
  onTransitionClick: (fromState: string, toState: string) => void;
}

function getTransitionCellColor(
  fromState: string,
  toState: string,
  transitions: OutgoingTransition[],
  validation: TransitionValidation
): { color: string; count: number } {
  const matchingTransitions = transitions.filter(
    (t) => t.fromState === fromState && t.activateStates.includes(toState)
  );

  if (matchingTransitions.length === 0) {
    return { color: COLORS.gray, count: 0 };
  }

  // Check if any matching transition is circular
  const hasCircular = matchingTransitions.some((t) =>
    validation.circular.includes(t.id)
  );
  if (hasCircular) {
    return { color: COLORS.danger, count: matchingTransitions.length };
  }

  if (matchingTransitions.length > 1) {
    return { color: COLORS.warning, count: matchingTransitions.length };
  }

  return { color: COLORS.success, count: matchingTransitions.length };
}

export function TransitionMatrixView({
  transitions,
  states,
  validation,
  onTransitionClick,
}: TransitionMatrixViewProps) {
  const outgoingTransitions = transitions.filter(
    (t): t is OutgoingTransition => t.type === "OutgoingTransition"
  );

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium text-gray-400">
              From \ To
            </th>
            {states.map((state) => (
              <th
                key={state.id}
                className="sticky top-0 z-10 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium text-gray-400 min-w-[100px]"
              >
                <div className="truncate" title={state.name}>
                  {state.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {states.map((fromState) => (
            <tr key={fromState.id}>
              <td className="sticky left-0 z-10 bg-[#27272A] border border-gray-700 p-2 text-xs font-medium">
                <div className="truncate" title={fromState.name}>
                  {fromState.name}
                </div>
              </td>
              {states.map((toState) => {
                const { color, count } = getTransitionCellColor(
                  fromState.id,
                  toState.id,
                  outgoingTransitions,
                  validation
                );
                return (
                  <td
                    key={toState.id}
                    className="border border-gray-700 p-0 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => onTransitionClick(fromState.id, toState.id)}
                  >
                    <div
                      className="h-12 flex items-center justify-center"
                      style={{ backgroundColor: `${color}20` }}
                    >
                      {count > 0 && (
                        <Badge
                          className="text-xs"
                          style={{ backgroundColor: color, color: "black" }}
                        >
                          {count}
                        </Badge>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
