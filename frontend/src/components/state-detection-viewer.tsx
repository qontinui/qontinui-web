"use client";

/**
 * State Detection Viewer Component
 *
 * A comprehensive UI for viewing, editing, and managing state detection results
 * from automation sessions. Provides state list, detail view, screenshot visualization,
 * and export capabilities.
 */

import React, { useState, useCallback } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Download,
  Edit2,
  Check,
  X,
  Upload,
  RefreshCw,
  AlertCircle,
  Image as ImageIcon,
  Clock,
  MousePointerClick,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// TypeScript Interfaces
interface DiscoveredState {
  state_id: string;
  screenshot_ids: number[];
  representative_screenshot_id: number;
  timestamp_first_seen: string;
  timestamp_last_seen: string;
  visit_count: number;
  input_events: number[];
  outgoing_transitions: StateTransition[];
  metadata: {
    screenshot_count: number;
    duration_seconds: number;
  };
}

interface StateTransition {
  from_state_id: string;
  to_state_id: string;
  trigger_event_id: number;
  event_type: string;
  timestamp: string;
  confidence: number;
}

interface StateDetectionResponse {
  session_id: string;
  total_states: number;
  total_transitions: number;
  states: DiscoveredState[];
  algorithm: string;
  parameters: Record<string, unknown>;
  processing_time_ms: number;
}

interface StateDetectionViewerProps {
  sessionId?: string;
  onExport?: (states: DiscoveredState[]) => void;
  className?: string;
}

export function StateDetectionViewer({
  sessionId: initialSessionId,
  onExport,
  className,
}: StateDetectionViewerProps) {
  // State Management
  const [sessionId, setSessionId] = useState<string>(initialSessionId || "");
  const [states, setStates] = useState<DiscoveredState[]>([]);
  const [selectedState, setSelectedState] = useState<DiscoveredState | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStateId, setEditingStateId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [algorithm, setAlgorithm] = useState("timestamp_clustering");
  const [stateThreshold, setStateThreshold] = useState(2.0);
  const [maxInputDistance, setMaxInputDistance] = useState(5.0);
  const [metadata, setMetadata] = useState<StateDetectionResponse | null>(null);

  // Load states from API
  const loadStates = useCallback(async () => {
    if (!sessionId) {
      setError("Please enter a session ID");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient["fetchWithAuth"](
        `/state-discovery/sessions/${sessionId}/discovered-states?algorithm=${algorithm}&state_threshold_seconds=${stateThreshold}&max_input_distance_seconds=${maxInputDistance}`,
        { method: "GET" }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Failed to load states" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data: StateDetectionResponse = await response.json();
      setStates(data.states);
      setMetadata(data);
      setSelectedState(data.states[0] || null);
      toast.success(
        `Loaded ${data.total_states} states in ${data.processing_time_ms.toFixed(1)}ms`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load states";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, algorithm, stateThreshold, maxInputDistance]);

  // Rename state
  const handleRenameState = useCallback(
    async (stateId: string, newName: string) => {
      if (!newName.trim()) {
        toast.error("State name cannot be empty");
        return;
      }

      try {
        const response = await apiClient["fetchWithAuth"](
          `/state-detection/states/${stateId}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name: newName }),
          }
        );

        if (!response.ok) {
          throw new Error("Failed to rename state");
        }

        // Update local state
        setStates((prev) =>
          prev.map((s) =>
            s.state_id === stateId ? { ...s, state_id: newName } : s
          )
        );

        if (selectedState?.state_id === stateId) {
          setSelectedState((prev) =>
            prev ? { ...prev, state_id: newName } : null
          );
        }

        setEditingStateId(null);
        setEditValue("");
        toast.success("State renamed successfully");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to rename state";
        toast.error(message);
      }
    },
    [selectedState]
  );

  // Export states to automation project
  const handleExport = useCallback(async () => {
    if (states.length === 0) {
      toast.error("No states to export");
      return;
    }

    if (onExport) {
      onExport(states);
      return;
    }

    try {
      const response = await apiClient["fetchWithAuth"](
        "/automation/import-state",
        {
          method: "POST",
          body: JSON.stringify({ states, session_id: sessionId }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to export states");
      }

      const result = await response.json();
      toast.success(
        `Exported ${result.imported_count} states to automation project`
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to export states";
      toast.error(message);
    }
  }, [states, sessionId, onExport]);

  // Filter states based on search query
  const filteredStates = states.filter((state) =>
    state.state_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  };

  return (
    <div className={cn("flex flex-col h-full gap-4 p-4", className)}>
      {/* Header */}
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
              onChange={(e) => setSessionId(e.target.value)}
              className="flex-1"
              disabled={isLoading}
            />
            <Button onClick={loadStates} disabled={isLoading || !sessionId}>
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
                onChange={(e) => setAlgorithm(e.target.value)}
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
                onChange={(e) => setStateThreshold(parseFloat(e.target.value))}
                disabled={isLoading}
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="sdv-max-input-dist"
                className="text-xs font-medium"
              >
                Max Input Distance (s)
              </label>
              <Input
                id="sdv-max-input-dist"
                type="number"
                step="0.1"
                value={maxInputDistance}
                onChange={(e) =>
                  setMaxInputDistance(parseFloat(e.target.value))
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
              <span>
                Processing: {metadata.processing_time_ms.toFixed(1)}ms
              </span>
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

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Left Panel - State List */}
        <Card className="col-span-1">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">States</CardTitle>
              <Badge variant="secondary">{filteredStates.length}</Badge>
            </div>
            {/* Search */}
            <div className="relative mt-2">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search states..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              <div className="space-y-1 p-2">
                {filteredStates.map((state) => (
                  <div
                    key={state.state_id}
                    onClick={() => setSelectedState(state)}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-colors border",
                      selectedState?.state_id === state.state_id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-accent border-transparent"
                    )}
                  >
                    {editingStateId === state.state_id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleRenameState(state.state_id, editValue);
                            } else if (e.key === "Escape") {
                              setEditingStateId(null);
                              setEditValue("");
                            }
                          }}
                          className="h-7 text-xs"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() =>
                            handleRenameState(state.state_id, editValue)
                          }
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditingStateId(null);
                            setEditValue("");
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            {state.state_id}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingStateId(state.state_id);
                              setEditValue(state.state_id);
                            }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            <span>{state.metadata.screenshot_count}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>
                              {formatDuration(state.metadata.duration_seconds)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <MousePointerClick className="h-3 w-3" />
                            <span>{state.input_events.length}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Badge variant="secondary" className="text-xs">
                            Visits: {state.visit_count}
                          </Badge>
                          {state.outgoing_transitions.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              <ArrowRight className="h-2 w-2 mr-1" />
                              {state.outgoing_transitions.length}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {filteredStates.length === 0 && !isLoading && (
                  <div className="text-center text-muted-foreground py-8">
                    {states.length === 0
                      ? "No states loaded"
                      : "No states match search"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
          <CardFooter className="pt-3 pb-3">
            <Button
              onClick={handleExport}
              disabled={states.length === 0}
              className="w-full"
            >
              <Upload className="w-4 h-4 mr-2" />
              Export to Automation
            </Button>
          </CardFooter>
        </Card>

        {/* Right Panel - State Details (2 columns) */}
        <div className="col-span-2 grid grid-cols-2 gap-4">
          {/* State Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">State Details</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedState ? (
                <ScrollArea className="h-[600px]">
                  <div className="space-y-4">
                    {/* Basic Info */}
                    <div className="space-y-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          State ID
                        </p>
                        <p className="text-sm font-mono">
                          {selectedState.state_id}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          First Seen
                        </p>
                        <p className="text-sm">
                          {formatTimestamp(selectedState.timestamp_first_seen)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Last Seen
                        </p>
                        <p className="text-sm">
                          {formatTimestamp(selectedState.timestamp_last_seen)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">
                          Duration
                        </p>
                        <p className="text-sm">
                          {formatDuration(
                            selectedState.metadata.duration_seconds
                          )}
                        </p>
                      </div>
                    </div>

                    <Separator />

                    {/* Screenshots */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Screenshots ({selectedState.screenshot_ids.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {selectedState.screenshot_ids.map((id) => (
                          <Badge
                            key={id}
                            variant="secondary"
                            className="text-xs"
                          >
                            #{id}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Representative: #
                        {selectedState.representative_screenshot_id}
                      </p>
                    </div>

                    <Separator />

                    {/* Input Events */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Input Events ({selectedState.input_events.length})
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {selectedState.input_events.map((id) => (
                          <Badge key={id} variant="outline" className="text-xs">
                            #{id}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    {/* Transitions */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Outgoing Transitions (
                        {selectedState.outgoing_transitions.length})
                      </p>
                      <div className="space-y-2">
                        {selectedState.outgoing_transitions.map(
                          (transition, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded-md border bg-accent/50 space-y-1"
                            >
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-medium">
                                  {transition.from_state_id}
                                </span>
                                <ArrowRight className="h-3 w-3" />
                                <span className="font-medium">
                                  {transition.to_state_id}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Event: {transition.event_type} (#
                                {transition.trigger_event_id})
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Confidence:{" "}
                                {(transition.confidence * 100).toFixed(0)}%
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatTimestamp(transition.timestamp)}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              ) : (
                <div className="flex items-center justify-center h-[600px] text-muted-foreground">
                  Select a state to view details
                </div>
              )}
            </CardContent>
          </Card>

          {/* Screenshot Visualization */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Screenshot Preview</CardTitle>
              <CardDescription className="text-xs">
                {selectedState
                  ? `Showing representative screenshot #${selectedState.representative_screenshot_id}`
                  : "Select a state to view screenshots"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedState ? (
                <div className="space-y-2">
                  {/* Screenshot Image Placeholder */}
                  <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border-2 border-dashed">
                    <div className="text-center space-y-2">
                      <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Screenshot #{selectedState.representative_screenshot_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Image loading not implemented
                      </p>
                    </div>
                  </div>

                  {/* Screenshot Navigation */}
                  <div className="flex items-center justify-between">
                    <Button variant="outline" size="sm" disabled>
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      1 of {selectedState.screenshot_ids.length}
                    </span>
                    <Button variant="outline" size="sm" disabled>
                      Next
                    </Button>
                  </div>

                  <Separator />

                  {/* Download Actions */}
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Screenshot
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download All Screenshots
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[600px] text-muted-foreground">
                  <div className="text-center space-y-2">
                    <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                    <p className="text-sm">No state selected</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default StateDetectionViewer;
