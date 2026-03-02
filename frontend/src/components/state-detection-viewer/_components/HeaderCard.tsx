import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RefreshCw, AlertCircle, Loader2 } from "lucide-react";
import type { StateDetectionResponse } from "../types";

interface HeaderCardProps {
  sessionId: string;
  onSessionIdChange: (value: string) => void;
  isLoading: boolean;
  onLoadStates: () => void;
  algorithm: string;
  onAlgorithmChange: (value: string) => void;
  stateThreshold: number;
  onStateThresholdChange: (value: number) => void;
  maxInputDistance: number;
  onMaxInputDistanceChange: (value: number) => void;
  metadata: StateDetectionResponse | null;
  error: string | null;
}

export function HeaderCard({
  sessionId,
  onSessionIdChange,
  isLoading,
  onLoadStates,
  algorithm,
  onAlgorithmChange,
  stateThreshold,
  onStateThresholdChange,
  maxInputDistance,
  onMaxInputDistanceChange,
  metadata,
  error,
}: HeaderCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>State Detection Viewer</CardTitle>
        <CardDescription>
          View and manage detected states from automation sessions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Session Input */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter session ID (UUID)"
            value={sessionId}
            onChange={(e) => onSessionIdChange(e.target.value)}
            className="flex-1"
            disabled={isLoading}
          />
          <Button onClick={onLoadStates} disabled={isLoading || !sessionId}>
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Load States
              </>
            )}
          </Button>
        </div>

        {/* Algorithm Parameters */}
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label htmlFor="sdv-algorithm" className="text-xs font-medium">
              Algorithm
            </label>
            <Input
              id="sdv-algorithm"
              value={algorithm}
              onChange={(e) => onAlgorithmChange(e.target.value)}
              disabled={isLoading}
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="sdv-state-threshold"
              className="text-xs font-medium"
            >
              State Threshold (s)
            </label>
            <Input
              id="sdv-state-threshold"
              type="number"
              step="0.1"
              value={stateThreshold}
              onChange={(e) =>
                onStateThresholdChange(parseFloat(e.target.value))
              }
              disabled={isLoading}
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="sdv-max-input-dist" className="text-xs font-medium">
              Max Input Distance (s)
            </label>
            <Input
              id="sdv-max-input-dist"
              type="number"
              step="0.1"
              value={maxInputDistance}
              onChange={(e) =>
                onMaxInputDistanceChange(parseFloat(e.target.value))
              }
              disabled={isLoading}
              className="text-xs"
            />
          </div>
        </div>

        {/* Metadata */}
        {metadata && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Total States: {metadata.total_states}</span>
            <span>Transitions: {metadata.total_transitions}</span>
            <span>Processing: {metadata.processing_time_ms.toFixed(1)}ms</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
