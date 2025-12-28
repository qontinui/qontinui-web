"use client";

/**
 * UnifiedStepCard - Displays execution steps from both real TreeEvents and mock testing
 *
 * This component provides a unified UI for displaying:
 * - Real execution events from qontinui-runner (TreeEvents)
 * - Mock/simulation steps from integration testing
 *
 * Uses the UnifiedExecutionStep type to normalize both formats.
 */

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
  ArrowRight,
  Camera,
  Loader2,
} from "lucide-react";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import {
  getStepTypeIcon,
  getStepTypeLabel,
} from "@/lib/tree-event-adapter";

interface UnifiedStepCardProps {
  step: UnifiedExecutionStep;
  isExpanded?: boolean;
  onToggle?: () => void;
  isCurrent?: boolean;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
}

/**
 * Helper to resolve an ID to a display name
 */
function resolveName(id: string, nameMap?: Map<string, string>): string {
  return nameMap?.get(id) ?? id;
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms === 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
}

export function UnifiedStepCard({
  step,
  isExpanded = false,
  onToggle,
  isCurrent = false,
  nameMap,
}: UnifiedStepCardProps) {
  const [localExpanded, setLocalExpanded] = useState(isExpanded);
  const expanded = onToggle ? isExpanded : localExpanded;
  const toggle = onToggle ?? (() => setLocalExpanded(!localExpanded));

  const getStepIcon = () => {
    const iconName = getStepTypeIcon(step);

    const iconProps = { className: "w-5 h-5" };

    switch (iconName) {
      case "compass":
        return <Compass {...iconProps} className="w-5 h-5 text-blue-400" />;
      case "route":
        return <Route {...iconProps} className="w-5 h-5 text-purple-400" />;
      case "refresh-cw":
        return <RefreshCw {...iconProps} className="w-5 h-5 text-cyan-400" />;
      case "mouse-pointer-2":
        return <MousePointer2 {...iconProps} className="w-5 h-5 text-green-400" />;
      case "keyboard":
        return <Keyboard {...iconProps} className="w-5 h-5 text-yellow-400" />;
      case "eye":
        return <Eye {...iconProps} className="w-5 h-5 text-blue-400" />;
      case "move":
        return <Move {...iconProps} className="w-5 h-5 text-orange-400" />;
      case "camera":
        return <ImageIcon {...iconProps} className="w-5 h-5 text-pink-400" />;
      case "clock":
        return <Clock {...iconProps} className="w-5 h-5 text-gray-400" />;
      case "layers":
        return <Layers {...iconProps} className="w-5 h-5 text-purple-400" />;
      case "arrow-right":
        return <ArrowRight {...iconProps} className="w-5 h-5 text-cyan-400" />;
      default:
        return <Play {...iconProps} className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusBadge = () => {
    switch (step.status) {
      case "success":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Success
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">
            <Info className="w-3 h-3 mr-1" />
            Info
          </Badge>
        );
    }
  };

  const getQuickPreview = () => {
    // State context preview
    if (step.stateContext?.activeAfter && step.stateContext.activeAfter.length > 0) {
      return (
        <span>
          States:{" "}
          {step.stateContext.activeAfter
            .map((s) => resolveName(s, nameMap))
            .join(", ")}
        </span>
      );
    }

    // Input data preview
    if (step.inputData?.text) {
      return <span>Text: &quot;{step.inputData.text}&quot;</span>;
    }

    // Match location preview
    if (step.matchLocation) {
      return (
        <span>
          Match: ({step.matchLocation.x}, {step.matchLocation.y})
          {step.matchLocation.confidence && ` @ ${(step.matchLocation.confidence * 100).toFixed(0)}%`}
        </span>
      );
    }

    return null;
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
                      #{step.stepNumber}
                    </Badge>
                    <span className="text-sm font-medium text-white">
                      {step.name || getStepTypeLabel(step)}
                    </span>
                    {getStatusBadge()}
                    {isCurrent && (
                      <Badge className="bg-[#00D9FF]/20 text-[#00D9FF] border-[#00D9FF]/30 text-xs">
                        Current
                      </Badge>
                    )}
                    {step.isRealExecution && (
                      <Badge variant="outline" className="text-xs border-green-500/30 text-green-400">
                        Live
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(step.durationMs)}
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

                {/* Quick preview */}
                <div className="mt-2 text-xs text-gray-400">
                  {getQuickPreview()}
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 pb-4 pt-0 border-t border-gray-800/50">
            <div className="pt-4">
              <StepDetails step={step} nameMap={nameMap} />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/**
 * Detail section for expanded step view
 */
function StepDetails({
  step,
  nameMap,
}: {
  step: UnifiedExecutionStep;
  nameMap?: Map<string, string>;
}) {
  return (
    <div className="space-y-4">
      {/* Basic Info Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {step.actionType && (
          <div>
            <div className="text-xs text-gray-400 mb-1">Action Type</div>
            <Badge className="bg-gray-700/50 text-white">
              {step.actionType.toUpperCase()}
            </Badge>
          </div>
        )}
        {step.nodeType && (
          <div>
            <div className="text-xs text-gray-400 mb-1">Node Type</div>
            <Badge variant="outline" className="text-xs">
              {step.nodeType}
            </Badge>
          </div>
        )}
        <div>
          <div className="text-xs text-gray-400 mb-1">Duration</div>
          <span className="text-sm text-white">
            {formatDuration(step.durationMs)}
          </span>
        </div>
        {step.nodeId && (
          <div>
            <div className="text-xs text-gray-400 mb-1">Node ID</div>
            <span className="text-xs text-gray-500 font-mono truncate">
              {step.nodeId}
            </span>
          </div>
        )}
      </div>

      {/* State Context */}
      {step.stateContext && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Layers className="w-3 h-3" />
            State Context
          </div>
          <div className="grid grid-cols-2 gap-4">
            {step.stateContext.activeBefore && step.stateContext.activeBefore.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Before</div>
                <div className="flex flex-wrap gap-1">
                  {step.stateContext.activeBefore.map((state) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-blue-500/30 text-blue-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {step.stateContext.activeAfter && step.stateContext.activeAfter.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-1">After</div>
                <div className="flex flex-wrap gap-1">
                  {step.stateContext.activeAfter.map((state) => (
                    <Badge
                      key={state}
                      variant="outline"
                      className="text-xs border-green-500/30 text-green-400"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
          {step.stateContext.changed && (
            <div className="mt-2 text-xs text-cyan-400 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" />
              State changed
            </div>
          )}
        </div>
      )}

      {/* Match Location */}
      {step.matchLocation && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Match Location
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div>
              <span className="text-gray-500">X:</span>{" "}
              <span className="text-white">{step.matchLocation.x}</span>
            </div>
            <div>
              <span className="text-gray-500">Y:</span>{" "}
              <span className="text-white">{step.matchLocation.y}</span>
            </div>
            {step.matchLocation.width && step.matchLocation.height && (
              <div>
                <span className="text-gray-500">Size:</span>{" "}
                <span className="text-white">
                  {step.matchLocation.width}x{step.matchLocation.height}
                </span>
              </div>
            )}
            {step.matchLocation.confidence !== undefined && (
              <div>
                <span className="text-gray-500">Confidence:</span>{" "}
                <span className="text-white">
                  {(step.matchLocation.confidence * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input Data */}
      {step.inputData && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Keyboard className="w-3 h-3" />
            Input Data
          </div>
          {step.inputData.text && (
            <div className="text-sm">
              <span className="text-gray-500">Text:</span>{" "}
              <span className="text-white font-mono">&quot;{step.inputData.text}&quot;</span>
            </div>
          )}
          {step.inputData.from && step.inputData.to && (
            <div className="text-sm">
              <span className="text-gray-500">Drag:</span>{" "}
              <span className="text-white font-mono">
                ({step.inputData.from.x}, {step.inputData.from.y}) to (
                {step.inputData.to.x}, {step.inputData.to.y})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {step.error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-red-400 mb-1">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Error</span>
          </div>
          <div className="text-sm text-red-300">{step.error}</div>
        </div>
      )}

      {/* Screenshot */}
      {step.screenshotUrl && (
        <div className="bg-gray-800/30 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
            <Camera className="w-3 h-3" />
            Screenshot
          </div>
          <a
            href={step.screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#00D9FF] hover:underline"
          >
            View Screenshot
          </a>
        </div>
      )}

      {/* Debug: Show metadata if available */}
      {step.metadata && Object.keys(step.metadata).length > 0 && (
        <details className="text-xs">
          <summary className="text-gray-500 cursor-pointer hover:text-gray-400">
            Raw Metadata
          </summary>
          <pre className="mt-2 p-2 bg-gray-900/50 rounded text-gray-400 overflow-auto max-h-48">
            {JSON.stringify(step.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

export default UnifiedStepCard;
