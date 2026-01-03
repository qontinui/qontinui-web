/**
 * State List Component
 *
 * Displays discovered states from web extraction with:
 * - Screenshot preview with state bounding boxes
 * - State metadata (name, type, element count)
 * - Selection capabilities for import
 */

"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  FileSearch,
  Component,
  CheckSquare,
  Square,
  Image as ImageIcon,
  AlertCircle,
  Eye,
} from "lucide-react";
import { runnerClient } from "@/lib/runner-client";
import type { ExtractionAnnotation } from "@/services/extraction-service";
import { StateImageModal } from "./StateImageModal";

interface StateAnnotation {
  id: string;
  name: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  state_type: string;
  element_ids: string[];
}

interface StateListProps {
  annotations: ExtractionAnnotation[];
  selectedStateIds: Set<string>;
  onSelectionChange: (stateIds: Set<string>) => void;
  extractionId?: string;
}

/**
 * Screenshot preview with state bounding boxes overlaid
 */
function ScreenshotPreview({
  extractionId,
  screenshotId,
  states,
  selectedStateIds,
  onToggleState,
  viewportWidth,
  viewportHeight,
}: {
  extractionId: string;
  screenshotId: string;
  states: StateAnnotation[];
  selectedStateIds: Set<string>;
  onToggleState: (stateId: string) => void;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadScreenshot() {
      try {
        setLoading(true);
        setError(null);
        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          screenshotId
        );
        if (!mounted) return;

        if (result.success && result.blob) {
          const url = URL.createObjectURL(result.blob);
          setImageUrl(url);
        } else {
          setError(result.error || "Failed to load screenshot");
        }
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load screenshot");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadScreenshot();

    return () => {
      mounted = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [extractionId, screenshotId]);

  // Calculate scale to fit preview (max 400px wide)
  const maxPreviewWidth = 400;
  const scale = Math.min(1, maxPreviewWidth / viewportWidth);
  const previewWidth = viewportWidth * scale;
  const previewHeight = viewportHeight * scale;

  if (loading) {
    return (
      <div
        className="bg-muted animate-pulse rounded-lg flex items-center justify-center"
        style={{ width: previewWidth, height: previewHeight }}
      >
        <ImageIcon className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div
        className="bg-muted rounded-lg flex flex-col items-center justify-center gap-2 p-4"
        style={{ width: previewWidth, height: Math.min(previewHeight, 150) }}
      >
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        <p className="text-xs text-muted-foreground text-center">
          {error || "Screenshot unavailable"}
        </p>
        <p className="text-xs text-muted-foreground">
          Make sure the runner is connected
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-lg overflow-hidden border"
      style={{ width: previewWidth, height: previewHeight }}
    >
      {/* Screenshot image */}
      <img
        src={imageUrl}
        alt="Page screenshot"
        className="w-full h-full object-cover"
        style={{ width: previewWidth, height: previewHeight }}
      />

      {/* State bounding box overlays */}
      {states.map((state) => {
        const isSelected = selectedStateIds.has(state.id);
        return (
          <div
            key={state.id}
            className={`absolute border-2 cursor-pointer transition-all ${
              isSelected
                ? "border-[#00D9FF] bg-[#00D9FF]/20"
                : "border-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20"
            }`}
            style={{
              left: state.bbox.x * scale,
              top: state.bbox.y * scale,
              width: state.bbox.width * scale,
              height: state.bbox.height * scale,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleState(state.id);
            }}
            title={`${state.name} (${state.state_type})`}
          >
            {/* State label */}
            <div
              className={`absolute -top-5 left-0 text-xs px-1 py-0.5 rounded whitespace-nowrap ${
                isSelected
                  ? "bg-[#00D9FF] text-black"
                  : "bg-yellow-400 text-black"
              }`}
            >
              {state.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Extended state annotation with annotation context
interface StateWithContext extends StateAnnotation {
  source_url: string;
  viewport: string;
  screenshot_id: string;
  viewport_width: number;
  viewport_height: number;
}

// Element annotation type for the modal
interface ElementAnnotation {
  id: string;
  name?: string | null;
  element_type: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text?: string | null;
  selector?: string | null;
  confidence?: number;
}

export function StateList({
  annotations,
  selectedStateIds,
  onSelectionChange,
  extractionId,
}: StateListProps) {
  // State for viewing a specific state's image
  const [viewingState, setViewingState] = useState<StateWithContext | null>(
    null
  );
  // Elements from the current annotation being viewed
  const [viewingElements, setViewingElements] = useState<ElementAnnotation[]>(
    []
  );

  // Collect all states from all annotations with context
  const allStates = useMemo<StateWithContext[]>(
    () =>
      annotations.flatMap((annotation) =>
        (annotation.states as StateAnnotation[]).map((state) => ({
          ...state,
          source_url: annotation.source_url,
          viewport: `${annotation.viewport_width}x${annotation.viewport_height}`,
          screenshot_id: annotation.screenshot_id,
          viewport_width: annotation.viewport_width,
          viewport_height: annotation.viewport_height,
        }))
      ),
    [annotations]
  );

  const handleToggleState = (stateId: string) => {
    const newSelection = new Set(selectedStateIds);
    if (newSelection.has(stateId)) {
      newSelection.delete(stateId);
    } else {
      newSelection.add(stateId);
    }
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    const allIds = new Set(allStates.map((state) => state.id));
    onSelectionChange(allIds);
  };

  const handleDeselectAll = () => {
    onSelectionChange(new Set());
  };

  // Handle viewing a state's image
  const handleViewState = (
    state: StateAnnotation,
    annotation: ExtractionAnnotation
  ) => {
    const stateWithContext: StateWithContext = {
      ...state,
      source_url: annotation.source_url,
      viewport: `${annotation.viewport_width}x${annotation.viewport_height}`,
      screenshot_id: annotation.screenshot_id,
      viewport_width: annotation.viewport_width,
      viewport_height: annotation.viewport_height,
    };
    setViewingState(stateWithContext);
    // Store elements from this annotation for the modal
    const elements = (annotation.elements as ElementAnnotation[]) || [];
    setViewingElements(elements);
  };

  // Handle closing the modal
  const handleCloseModal = () => {
    setViewingState(null);
    setViewingElements([]);
  };

  if (allStates.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center text-center space-y-3">
            <FileSearch className="h-12 w-12 text-muted-foreground" />
            <div>
              <h3 className="font-semibold">No States Found</h3>
              <p className="text-sm text-muted-foreground">
                No states have been discovered yet. Start an extraction to find
                states.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5" />
              Discovered States
            </CardTitle>
            <CardDescription>
              {allStates.length} state{allStates.length !== 1 ? "s" : ""} found
              across {annotations.length} page
              {annotations.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleSelectAll}
              variant="outline"
              size="sm"
              disabled={selectedStateIds.size === allStates.length}
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              Select All
            </Button>
            <Button
              onClick={handleDeselectAll}
              variant="outline"
              size="sm"
              disabled={selectedStateIds.size === 0}
            >
              <Square className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px] pr-4">
          <div className="space-y-6">
            {/* Group by annotation (screenshot) */}
            {annotations.map((annotation) => {
              const annotationStates = annotation.states as StateAnnotation[];
              if (annotationStates.length === 0) return null;

              return (
                <div
                  key={annotation.screenshot_id}
                  className="border rounded-lg p-4 space-y-4"
                >
                  {/* Annotation header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium truncate max-w-md">
                        {annotation.source_url}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {annotation.viewport_width}x{annotation.viewport_height}{" "}
                        • {annotationStates.length} state
                        {annotationStates.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const stateIds = annotationStates.map((s) => s.id);
                        const allSelected = stateIds.every((id) =>
                          selectedStateIds.has(id)
                        );
                        const newSelection = new Set(selectedStateIds);
                        if (allSelected) {
                          stateIds.forEach((id) => newSelection.delete(id));
                        } else {
                          stateIds.forEach((id) => newSelection.add(id));
                        }
                        onSelectionChange(newSelection);
                      }}
                    >
                      {annotationStates.every((s) =>
                        selectedStateIds.has(s.id)
                      ) ? (
                        <>
                          <Square className="h-4 w-4 mr-1" />
                          Deselect Page
                        </>
                      ) : (
                        <>
                          <CheckSquare className="h-4 w-4 mr-1" />
                          Select Page
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Screenshot preview with overlays */}
                  {extractionId && (
                    <ScreenshotPreview
                      extractionId={extractionId}
                      screenshotId={annotation.screenshot_id}
                      states={annotationStates}
                      selectedStateIds={selectedStateIds}
                      onToggleState={handleToggleState}
                      viewportWidth={annotation.viewport_width}
                      viewportHeight={annotation.viewport_height}
                    />
                  )}

                  {/* State list for this annotation */}
                  <div className="space-y-2">
                    {annotationStates.map((state) => (
                      <div
                        key={state.id}
                        className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                          selectedStateIds.has(state.id)
                            ? "bg-[#00D9FF]/10 border border-[#00D9FF]"
                            : "hover:bg-muted"
                        }`}
                      >
                        <Checkbox
                          checked={selectedStateIds.has(state.id)}
                          onCheckedChange={() => handleToggleState(state.id)}
                        />
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleToggleState(state.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {state.name}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {state.state_type}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Component className="h-3 w-3" />
                              {state.element_ids.length} elements
                            </span>
                            <span>
                              ({state.bbox.x}, {state.bbox.y}) •{" "}
                              {state.bbox.width}×{state.bbox.height}
                            </span>
                          </div>
                        </div>
                        {/* View state image button */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewState(state, annotation);
                          }}
                          title="View state image"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {selectedStateIds.size > 0 && (
          <>
            <Separator className="my-4" />
            <div className="text-sm text-center text-muted-foreground">
              {selectedStateIds.size} state
              {selectedStateIds.size !== 1 ? "s" : ""} selected for import
            </div>
          </>
        )}
      </CardContent>

      {/* State Image Modal */}
      {viewingState && extractionId && (
        <StateImageModal
          isOpen={!!viewingState}
          onClose={handleCloseModal}
          state={viewingState}
          elements={viewingElements}
          extractionId={extractionId}
          screenshotId={viewingState.screenshot_id}
          viewportWidth={viewingState.viewport_width}
          viewportHeight={viewingState.viewport_height}
        />
      )}
    </Card>
  );
}
