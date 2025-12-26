"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Compass,
  Route,
  Play,
  RefreshCw,
  AlertTriangle,
  Info,
  Layers,
  Target,
  MousePointer2,
  Keyboard,
  Move,
  Eye,
  Image as ImageIcon,
} from "lucide-react";
import type {
  ExecutionStep,
  StateDiscoveryStep,
  PathCalculationStep,
  ActionStep,
  StateUpdateStep,
  CalculatedPath,
  HistoricalActionStats,
} from "@/types/integration-testing";

interface ExecutionStepCardProps {
  step: ExecutionStep;
  isExpanded?: boolean;
  onToggle?: () => void;
  isCurrent?: boolean;
}

export function ExecutionStepCard({
  step,
  isExpanded = false,
  onToggle,
  isCurrent = false,
}: ExecutionStepCardProps) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);
  const expanded = onToggle ? isExpanded : localExpanded;
  const toggle = onToggle ?? (() => setLocalExpanded(!localExpanded));

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

  const getActionIcon = (actionStep: ActionStep) => {
    switch (actionStep.action_type) {
      case "click":
        return <MousePointer2 className="w-5 h-5 text-green-400" />;
      case "type":
        return <Keyboard className="w-5 h-5 text-yellow-400" />;
      case "drag":
        return <Move className="w-5 h-5 text-orange-400" />;
      case "find":
        return <Eye className="w-5 h-5 text-blue-400" />;
      case "screenshot":
        return <ImageIcon className="w-5 h-5 text-pink-400" />;
      default:
        return <Play className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStepTitle = () => {
    switch (step.type) {
      case "state_discovery":
        return "State Discovery";
      case "path_calculation":
        return `Path Calculation to ${step.target_state}`;
      case "action":
        return `${step.action_type.toUpperCase()}: ${step.action_name}`;
      case "state_update":
        return "State Update";
    }
  };

  const getStatusBadge = () => {
    if (step.type === "action") {
      const actionStep = step as ActionStep;
      if (actionStep.result.success) {
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Success
          </Badge>
        );
      }
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    }
    if (step.type === "state_discovery") {
      const discoveryStep = step as StateDiscoveryStep;
      if (discoveryStep.initial_states_match) {
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Match
          </Badge>
        );
      }
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
          <AlertTriangle className="w-3 h-3 mr-1" />
          Mismatch
        </Badge>
      );
    }
    if (step.type === "path_calculation") {
      const pathStep = step as PathCalculationStep;
      if (pathStep.no_path_found) {
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            No Path
          </Badge>
        );
      }
      if (pathStep.selected_path) {
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Path Found
          </Badge>
        );
      }
    }
    return (
      <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
        <Info className="w-3 h-3 mr-1" />
        Info
      </Badge>
    );
  };

  const formatDuration = (ms: number) => {
    if (ms === 0) return "0ms (virtual)";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <Card
      className={`bg-[#1A1A1B]/50 border-gray-800/50 transition-all ${
        isCurrent
          ? "ring-2 ring-[#00D9FF]/50 shadow-lg shadow-[#00D9FF]/10"
          : ""
      }`}
    >
      <Collapsible open={expanded} onOpenChange={toggle}>
        <CollapsibleTrigger asChild>
          <CardContent className="p-4 cursor-pointer hover:bg-gray-800/20 transition-colors">
            <div className="flex items-start gap-3">
              {/* Step icon */}
              <div className="flex-shrink-0 mt-0.5">{getStepIcon()}</div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-xs font-mono">
                      #{step.step_number}
                    </Badge>
                    <span className="text-sm font-medium text-white">
                      {getStepTitle()}
                    </span>
                    {getStatusBadge()}
                    {isCurrent && (
                      <Badge className="bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30 text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(step.duration_ms)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-gray-700/50"
                    >
                      {expanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Quick preview based on step type */}
                <div className="mt-2 text-xs text-gray-400">
                  {step.type === "state_discovery" && (
                    <span>
                      Active States:{" "}
                      {(step as StateDiscoveryStep).active_states.join(", ") ||
                        "None"}
                    </span>
                  )}
                  {step.type === "path_calculation" && (
                    <span>
                      {(step as PathCalculationStep).available_paths.length}{" "}
                      path(s) available
                    </span>
                  )}
                  {step.type === "action" &&
                    (step as ActionStep).pattern_name && (
                      <span>Pattern: {(step as ActionStep).pattern_name}</span>
                    )}
                  {step.type === "state_update" && (
                    <span>
                      +{(step as StateUpdateStep).activated_states.length} / -
                      {(step as StateUpdateStep).deactivated_states.length}{" "}
                      states
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t border-gray-800/50">
            <div className="pt-4">
              {step.type === "state_discovery" && (
                <StateDiscoveryDetails step={step as StateDiscoveryStep} />
              )}
              {step.type === "path_calculation" && (
                <PathCalculationDetails step={step as PathCalculationStep} />
              )}
              {step.type === "action" && (
                <ActionDetails step={step as ActionStep} />
              )}
              {step.type === "state_update" && (
                <StateUpdateDetails step={step as StateUpdateStep} />
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// =============================================================================
// Detail Components
// =============================================================================

function StateDiscoveryDetails({ step }: { step: StateDiscoveryStep }) {
  return (
    <div className="space-y-4">
      {/* Active States */}
      <div>
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <Layers className="w-3 h-3" />
          Active States Detected
        </div>
        <div className="flex flex-wrap gap-2">
          {step.active_states.length > 0 ? (
            step.active_states.map((state) => (
              <Badge
                key={state}
                className="bg-blue-500/10 text-blue-400 border-blue-500/30"
              >
                {state}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-gray-500">No states detected</span>
          )}
        </div>
      </div>

      {/* Expected vs Actual */}
      {step.expected_initial_states.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-400 mb-2">
              Expected Initial States
            </div>
            <div className="flex flex-wrap gap-1">
              {step.expected_initial_states.map((state) => (
                <Badge key={state} variant="outline" className="text-xs">
                  {state}
                </Badge>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-2">Match Status</div>
            {step.initial_states_match ? (
              <div className="flex items-center gap-1 text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                States match expected
              </div>
            ) : (
              <div className="flex items-center gap-1 text-yellow-400 text-sm">
                <AlertTriangle className="w-4 h-4" />
                States differ from expected
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detection Method */}
      <div>
        <div className="text-xs text-gray-400 mb-1">Detection Method</div>
        <Badge variant="outline" className="text-xs">
          {step.detection_method}
        </Badge>
      </div>
    </div>
  );
}

function PathCalculationDetails({ step }: { step: PathCalculationStep }) {
  return (
    <div className="space-y-4">
      {/* Target and Current States */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Target State
          </div>
          <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/30">
            {step.target_state}
          </Badge>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-2">Current States</div>
          <div className="flex flex-wrap gap-1">
            {step.current_states.map((state) => (
              <Badge key={state} variant="outline" className="text-xs">
                {state}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Available Paths */}
      {step.available_paths.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">Available Paths</div>
          <div className="space-y-2">
            {step.available_paths.map((path, index) => (
              <PathCard
                key={path.path_id}
                path={path}
                isSelected={step.selected_path?.path_id === path.path_id}
                index={index + 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Selection Reason */}
      {step.selected_path && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Selection Reason</div>
          <div className="text-sm text-white">{step.selection_reason}</div>
        </div>
      )}

      {/* No Path Found */}
      {step.no_path_found && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="w-4 h-4" />
            <span className="text-sm font-medium">
              No path found to target state
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            The state machine could not find a valid path from the current
            states to the target.
          </p>
        </div>
      )}
    </div>
  );
}

function PathCard({
  path,
  isSelected,
  index,
}: {
  path: CalculatedPath;
  isSelected: boolean;
  index: number;
}) {
  return (
    <div
      className={`rounded-lg p-3 border ${
        isSelected
          ? "bg-green-500/10 border-green-500/30"
          : "bg-gray-800/30 border-gray-700/50"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Path {index}</span>
          {isSelected && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
              Selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span>Cost: {path.total_cost}</span>
          <span>~{path.estimated_duration_ms}ms</span>
          <span>{(path.reliability_score * 100).toFixed(0)}% reliable</span>
        </div>
      </div>
      <div className="text-sm text-white font-mono">
        {path.states.join(" -> ")}
      </div>
    </div>
  );
}

function ActionDetails({ step }: { step: ActionStep }) {
  return (
    <div className="space-y-4">
      {/* Action Info */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-gray-400 mb-1">Action Type</div>
          <Badge className="bg-gray-700/50 text-white">
            {step.action_type.toUpperCase()}
          </Badge>
        </div>
        {step.pattern_name && (
          <div>
            <div className="text-xs text-gray-400 mb-1">Pattern</div>
            <span className="text-sm text-[#00D9FF]">{step.pattern_name}</span>
          </div>
        )}
        <div>
          <div className="text-xs text-gray-400 mb-1">Result</div>
          {step.result.success ? (
            <span className="text-sm text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Success
            </span>
          ) : (
            <span className="text-sm text-red-400 flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              Failed
            </span>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Duration</div>
          <span className="text-sm text-white">
            {step.result.actual_duration_ms}ms
          </span>
        </div>
      </div>

      {/* Match Info */}
      {step.match_location && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2">Match Location</div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div>
              <span className="text-gray-500">X:</span>{" "}
              <span className="text-white">{step.match_location.x}</span>
            </div>
            <div>
              <span className="text-gray-500">Y:</span>{" "}
              <span className="text-white">{step.match_location.y}</span>
            </div>
            <div>
              <span className="text-gray-500">Size:</span>{" "}
              <span className="text-white">
                {step.match_location.width}x{step.match_location.height}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Score:</span>{" "}
              <span className="text-white">
                {(step.match_location.score * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Input Data */}
      {step.input_data && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2">Input Data</div>
          {step.input_data.text && (
            <div className="text-sm">
              <span className="text-gray-500">Text:</span>{" "}
              <span className="text-white font-mono">
                {step.input_data.text}
              </span>
            </div>
          )}
          {step.input_data.from && step.input_data.to && (
            <div className="text-sm">
              <span className="text-gray-500">Drag:</span>{" "}
              <span className="text-white font-mono">
                ({step.input_data.from.x}, {step.input_data.from.y}) to (
                {step.input_data.to.x}, {step.input_data.to.y})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Historical Stats */}
      {step.historical_stats && (
        <HistoricalStatsCard stats={step.historical_stats} />
      )}

      {/* Stochastic Notes */}
      {step.stochastic_notes.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-yellow-400 mb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Stochastic Notes</span>
          </div>
          <ul className="list-disc list-inside text-xs text-gray-300 space-y-1">
            {step.stochastic_notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Error Message */}
      {step.result.error_message && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="text-xs text-red-400 font-medium mb-1">Error</div>
          <div className="text-sm text-red-300">
            {step.result.error_message}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoricalStatsCard({ stats }: { stats: HistoricalActionStats }) {
  const successRateColor =
    stats.success_rate >= 0.95
      ? "text-green-400"
      : stats.success_rate >= 0.8
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div className="bg-gray-800/30 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-3 flex items-center gap-1">
        <Info className="w-3 h-3" />
        Historical Statistics ({stats.record_count} records)
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-gray-500">Success Rate</div>
          <div className={`text-lg font-bold ${successRateColor}`}>
            {(stats.success_rate * 100).toFixed(1)}%
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Avg Duration</div>
          <div className="text-lg font-bold text-white">
            {stats.avg_duration_ms}ms
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">P95 Duration</div>
          <div className="text-lg font-bold text-white">
            {stats.p95_duration_ms}ms
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Record Count</div>
          <div className="text-lg font-bold text-white">
            {stats.record_count}
          </div>
        </div>
      </div>

      {/* Failure Reasons */}
      {stats.failure_reasons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700/50">
          <div className="text-xs text-gray-400 mb-2">
            Common Failure Reasons
          </div>
          <div className="space-y-1">
            {stats.failure_reasons.slice(0, 3).map((reason, index) => (
              <div
                key={index}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-gray-300 truncate">{reason.reason}</span>
                <span className="text-gray-500">
                  {reason.percentage.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StateUpdateDetails({ step }: { step: StateUpdateStep }) {
  return (
    <div className="space-y-4">
      {/* State Changes */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <span className="text-green-400">+</span> Activated States
          </div>
          <div className="flex flex-wrap gap-2">
            {step.activated_states.length > 0 ? (
              step.activated_states.map((state) => (
                <Badge
                  key={state}
                  className="bg-green-500/10 text-green-400 border-green-500/30"
                >
                  {state}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-gray-500">None</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <span className="text-red-400">-</span> Deactivated States
          </div>
          <div className="flex flex-wrap gap-2">
            {step.deactivated_states.length > 0 ? (
              step.deactivated_states.map((state) => (
                <Badge
                  key={state}
                  className="bg-red-500/10 text-red-400 border-red-500/30"
                >
                  {state}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-gray-500">None</span>
            )}
          </div>
        </div>
      </div>

      {/* New Active States */}
      <div>
        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
          <Layers className="w-3 h-3" />
          New Active States (S_Xi)
        </div>
        <div className="flex flex-wrap gap-2">
          {step.new_active_states.length > 0 ? (
            step.new_active_states.map((state) => (
              <Badge
                key={state}
                className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30"
              >
                {state}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-gray-500">No active states</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default ExecutionStepCard;
