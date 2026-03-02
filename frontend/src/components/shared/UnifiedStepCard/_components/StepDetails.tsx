"use client";

import { Badge } from "@/components/ui/badge";
import {
  Layers,
  RefreshCw,
  Target,
  Keyboard,
  AlertTriangle,
  Camera,
} from "lucide-react";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import { StepProgressMarker } from "../../StepProgressMarker";
import { resolveName, formatDuration } from "../utils";

interface StepDetailsProps {
  step: UnifiedExecutionStep;
  nameMap?: Map<string, string>;
  taskRunId?: string;
  enableProgressTracking?: boolean;
}

/**
 * Detail section for expanded step view.
 * Shows progress markers, info grid, state context, match location,
 * input data, errors, screenshots, and raw metadata.
 */
export function StepDetails({
  step,
  nameMap,
  taskRunId,
  enableProgressTracking,
}: StepDetailsProps) {
  const isRunning = step.status === "running";
  const showProgressMarker = enableProgressTracking && taskRunId && step.nodeId;

  return (
    <div className="space-y-4">
      {/* Progress Marker for Running Steps */}
      {showProgressMarker && (
        <StepProgressMarker
          taskRunId={taskRunId}
          checkpointId={step.nodeId!}
          isRunning={isRunning}
          autoRefresh={isRunning}
          compact={false}
        />
      )}

      {/* Basic Info Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {step.actionType && (
          <div>
            <div className="text-xs text-text-muted mb-1">Action Type</div>
            <Badge className="bg-border-default/50 text-white">
              {step.actionType.toUpperCase()}
            </Badge>
          </div>
        )}
        {step.nodeType && (
          <div>
            <div className="text-xs text-text-muted mb-1">Node Type</div>
            <Badge variant="outline" className="text-xs">
              {step.nodeType}
            </Badge>
          </div>
        )}
        <div>
          <div className="text-xs text-text-muted mb-1">Duration</div>
          <span className="text-sm text-white">
            {formatDuration(step.durationMs)}
          </span>
        </div>
        {step.nodeId && (
          <div>
            <div className="text-xs text-text-muted mb-1">Node ID</div>
            <span className="text-xs text-text-muted font-mono truncate">
              {step.nodeId}
            </span>
          </div>
        )}
      </div>

      {/* State Context */}
      {step.stateContext && (
        <div className="bg-surface-raised/30 rounded-lg p-3">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Layers className="w-3 h-3" />
            State Context
          </div>
          <div className="grid grid-cols-2 gap-4">
            {step.stateContext.activeBefore &&
              step.stateContext.activeBefore.length > 0 && (
                <div>
                  <div className="text-xs text-text-muted mb-1">Before</div>
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
            {step.stateContext.activeAfter &&
              step.stateContext.activeAfter.length > 0 && (
                <div>
                  <div className="text-xs text-text-muted mb-1">After</div>
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
        <div className="bg-surface-raised/30 rounded-lg p-3">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Target className="w-3 h-3" />
            Match Location
          </div>
          <div className="grid grid-cols-4 gap-2 text-sm">
            <div>
              <span className="text-text-muted">X:</span>{" "}
              <span className="text-white">{step.matchLocation.x}</span>
            </div>
            <div>
              <span className="text-text-muted">Y:</span>{" "}
              <span className="text-white">{step.matchLocation.y}</span>
            </div>
            {step.matchLocation.width && step.matchLocation.height && (
              <div>
                <span className="text-text-muted">Size:</span>{" "}
                <span className="text-white">
                  {step.matchLocation.width}x{step.matchLocation.height}
                </span>
              </div>
            )}
            {step.matchLocation.confidence !== undefined && (
              <div>
                <span className="text-text-muted">Confidence:</span>{" "}
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
        <div className="bg-surface-raised/30 rounded-lg p-3">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Keyboard className="w-3 h-3" />
            Input Data
          </div>
          {step.inputData.text && (
            <div className="text-sm">
              <span className="text-text-muted">Text:</span>{" "}
              <span className="text-white font-mono">
                &quot;{step.inputData.text}&quot;
              </span>
            </div>
          )}
          {step.inputData.from && step.inputData.to && (
            <div className="text-sm">
              <span className="text-text-muted">Drag:</span>{" "}
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
        <div className="bg-surface-raised/30 rounded-lg p-3">
          <div className="text-xs text-text-muted mb-2 flex items-center gap-1">
            <Camera className="w-3 h-3" />
            Screenshot
          </div>
          <a
            href={step.screenshotUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-brand-primary hover:underline"
          >
            View Screenshot
          </a>
        </div>
      )}

      {/* Debug: Show metadata if available */}
      {step.metadata && Object.keys(step.metadata).length > 0 && (
        <details className="text-xs">
          <summary className="text-text-muted cursor-pointer hover:text-text-muted">
            Raw Metadata
          </summary>
          <pre className="mt-2 p-2 bg-surface-canvas/50 rounded text-text-muted overflow-auto max-h-48">
            {JSON.stringify(step.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
