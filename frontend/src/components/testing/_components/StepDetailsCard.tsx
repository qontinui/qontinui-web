"use client";

import { Compass, Route, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExecutionStep } from "@/types/integration-testing";
import { resolveName, getActionIcon } from "../utils";

interface StepDetailsProps {
  step: ExecutionStep;
  nameMap?: Map<string, string>;
}

export function StepDetails({ step, nameMap }: StepDetailsProps) {
  const getStepIcon = () => {
    switch (step.type) {
      case "state_discovery":
        return <Compass className="w-5 h-5 text-blue-400" />;
      case "path_calculation":
        return <Route className="w-5 h-5 text-purple-400" />;
      case "action":
        return getActionIcon(step);
      case "state_update":
        return <RefreshCw className="w-5 h-5 text-cyan-400" />;
    }
  };

  const getStepTitle = () => {
    switch (step.type) {
      case "state_discovery":
        return "State Discovery";
      case "path_calculation":
        return `Path to ${resolveName(step.target_state, nameMap)}`;
      case "action":
        return `${step.action_type.toUpperCase()}: ${step.action_name}`;
      case "state_update":
        return "State Update";
    }
  };

  const getStatusBadge = () => {
    if (step.type === "action") {
      return step.result.success ? (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Success
        </Badge>
      ) : (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStepIcon()}
        <span className="text-sm font-medium text-white">{getStepTitle()}</span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-mono">
          Step #{step.step_number}
        </Badge>
        {getStatusBadge()}
      </div>

      <div className="text-xs text-text-muted">
        Duration:{" "}
        {step.duration_ms === 0 ? "0ms (virtual)" : `${step.duration_ms}ms`}
      </div>

      {step.type === "action" && step.pattern_name && (
        <div className="text-xs">
          <span className="text-text-muted">Pattern:</span>{" "}
          <span className="text-brand-primary">
            {resolveName(step.pattern_name, nameMap)}
          </span>
        </div>
      )}

      {step.type === "action" && step.match_location && (
        <div className="text-xs">
          <span className="text-text-muted">Location:</span>{" "}
          <span className="text-white font-mono">
            ({step.match_location.x}, {step.match_location.y})
          </span>
          <span className="text-text-muted ml-2">Score:</span>{" "}
          <span className="text-white">
            {(step.match_location.score * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {step.type === "state_update" && (
        <div className="space-y-1 text-xs">
          {step.activated_states.length > 0 && (
            <div>
              <span className="text-green-400">+</span>{" "}
              {step.activated_states
                .map((s) => resolveName(s, nameMap))
                .join(", ")}
            </div>
          )}
          {step.deactivated_states.length > 0 && (
            <div>
              <span className="text-red-400">-</span>{" "}
              {step.deactivated_states
                .map((s) => resolveName(s, nameMap))
                .join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
