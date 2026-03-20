/**
 * State List Component
 *
 * Four-column layout for discovered states:
 * 1. Left: Page thumbnails
 * 2. States list with selection checkboxes
 * 3. Elements of the selected state
 * 4. Right: Selected element details (position, size, image)
 */

"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  FileSearch,
  Component,
  CheckSquare,
  Square,
  Download,
  Loader2,
} from "lucide-react";
import type {
  ExtractionAnnotation,
  ImportResult,
} from "@/services/extraction-service";
import { PageThumbnailList } from "./PageThumbnailList";
import { ElementList } from "./ElementList";
import { ElementDetailView } from "./ElementDetailView";

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

interface StateListProps {
  annotations: ExtractionAnnotation[];
  selectedStateIds: Set<string>;
  onSelectionChange: (stateIds: Set<string>) => void;
  extractionId?: string;
  onImport?: (stateIds: string[]) => Promise<ImportResult>;
}

interface StateWithContext extends StateAnnotation {
  source_url: string;
  viewport: string;
  screenshot_id: string;
  viewport_width: number;
  viewport_height: number;
}

export function StateList({
  annotations,
  selectedStateIds,
  onSelectionChange,
  extractionId,
  onImport,
}: StateListProps) {
  const [isImporting, setIsImporting] = useState(false);
  // Selected page (annotation) - defaults to first
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(annotations[0]?.screenshot_id || null);

  // Selected state for viewing its elements
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);

  // Selected element for viewing details
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );

  // Get the selected annotation
  const selectedAnnotation = useMemo(
    () =>
      annotations.find((a) => a.screenshot_id === selectedAnnotationId) || null,
    [annotations, selectedAnnotationId]
  );

  // States for the selected annotation
  const annotationStates = useMemo(
    () => (selectedAnnotation?.states as StateAnnotation[]) || [],
    [selectedAnnotation]
  );

  // All elements for the selected annotation
  const annotationElements = useMemo(
    () => (selectedAnnotation?.elements as ElementAnnotation[]) || [],
    [selectedAnnotation]
  );

  // Get the selected state
  const selectedState = useMemo(
    () => annotationStates.find((s) => s.id === selectedStateId) || null,
    [annotationStates, selectedStateId]
  );

  // Elements belonging to the selected state
  const stateElements = useMemo(() => {
    if (!selectedState) return [];
    return annotationElements.filter((el) =>
      selectedState.element_ids.includes(el.id)
    );
  }, [selectedState, annotationElements]);

  // Get the selected element
  const selectedElement = useMemo(
    () => stateElements.find((el) => el.id === selectedElementId) || null,
    [stateElements, selectedElementId]
  );

  // All states across all annotations
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

  const handleSelectPage = () => {
    if (!selectedAnnotation) return;
    const pageStateIds = annotationStates.map((s) => s.id);
    const allSelected = pageStateIds.every((id) => selectedStateIds.has(id));
    const newSelection = new Set(selectedStateIds);

    if (allSelected) {
      pageStateIds.forEach((id) => newSelection.delete(id));
    } else {
      pageStateIds.forEach((id) => newSelection.add(id));
    }
    onSelectionChange(newSelection);
  };

  const handleSelectState = (stateId: string) => {
    setSelectedStateId(stateId);
    setSelectedElementId(null); // Reset element selection when state changes
  };

  const handleSelectElement = (elementId: string) => {
    setSelectedElementId(elementId);
  };

  const handleSelectAnnotation = (annotationId: string) => {
    setSelectedAnnotationId(annotationId);
    setSelectedStateId(null);
    setSelectedElementId(null);
  };

  const handleImportSelected = async () => {
    if (!onImport || selectedStateIds.size === 0) return;
    setIsImporting(true);
    try {
      await onImport(Array.from(selectedStateIds));
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportAll = async () => {
    if (!onImport) return;
    setIsImporting(true);
    try {
      await onImport([]);
    } finally {
      setIsImporting(false);
    }
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

  const pageAllSelected = annotationStates.every((s) =>
    selectedStateIds.has(s.id)
  );

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <CardHeader className="shrink-0 py-1 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSearch className="h-4 w-4" />
            Discovered States
            {selectedStateIds.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedStateIds.size} selected
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {onImport && (
              <>
                <Button
                  onClick={handleImportSelected}
                  variant="default"
                  size="sm"
                  disabled={selectedStateIds.size === 0 || isImporting}
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  Import Selected
                </Button>
                <Button
                  onClick={handleImportAll}
                  variant="outline"
                  size="sm"
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  Import All
                </Button>
              </>
            )}
            <Button
              onClick={handleSelectAll}
              variant="ghost"
              size="sm"
              disabled={selectedStateIds.size === allStates.length}
            >
              <CheckSquare className="h-4 w-4 mr-1" />
              All
            </Button>
            <Button
              onClick={handleDeselectAll}
              variant="ghost"
              size="sm"
              disabled={selectedStateIds.size === 0}
            >
              <Square className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0">
        <div className="h-full flex border-t">
          {/* Column 1: Page Thumbnails */}
          <div className="w-80 shrink-0 border-r bg-muted/30 h-full overflow-hidden">
            {extractionId && (
              <PageThumbnailList
                annotations={annotations}
                extractionId={extractionId}
                selectedAnnotationId={selectedAnnotationId}
                onSelectAnnotation={handleSelectAnnotation}
              />
            )}
          </div>

          {/* Column 2: States List */}
          <div className="w-72 shrink-0 border-r flex flex-col h-full overflow-hidden">
            {selectedAnnotation && (
              <>
                {/* Page Header */}
                <div className="p-3 border-b shrink-0 bg-muted/20">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {selectedAnnotation.source_url}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selectedAnnotation.viewport_width}x
                        {selectedAnnotation.viewport_height} •{" "}
                        {annotationStates.length} state
                        {annotationStates.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-xs"
                      onClick={handleSelectPage}
                    >
                      {pageAllSelected ? (
                        <>
                          <Square className="h-3 w-3 mr-1" />
                          Deselect
                        </>
                      ) : (
                        <>
                          <CheckSquare className="h-3 w-3 mr-1" />
                          Select
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* States */}
                <ScrollArea className="flex-1">
                  <div className="p-2 space-y-1">
                    {annotationStates.map((state) => {
                      const isChecked = selectedStateIds.has(state.id);
                      const isSelected = selectedStateId === state.id;

                      return (
                        <div
                          key={state.id}
                          role="option"
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`flex items-center gap-2 p-2 rounded-md transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-brand-primary/20 ring-1 ring-brand-primary"
                              : isChecked
                                ? "bg-primary/10"
                                : "hover:bg-muted"
                          }`}
                          onClick={() => handleSelectState(state.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelectState(state.id); } }}
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => handleToggleState(state.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">
                                {state.name}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {state.state_type}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="flex items-center gap-0.5">
                                <Component className="h-3 w-3" />
                                {state.element_ids.length}
                              </span>
                              <span>
                                {state.bbox.width}×{state.bbox.height}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>

          {/* Column 3: Elements List */}
          <div className="w-72 shrink-0 border-r bg-muted/20 h-full overflow-hidden">
            {selectedState ? (
              <ElementList
                elements={stateElements}
                selectedElementId={selectedElementId}
                onSelectElement={handleSelectElement}
                stateName={selectedState.name}
              />
            ) : (
              <div className="h-full flex items-center justify-center p-4">
                <div className="text-center text-muted-foreground">
                  <Component className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a state to view elements</p>
                </div>
              </div>
            )}
          </div>

          {/* Column 4: Element Details */}
          <div className="flex-1 min-w-0 bg-muted/10 h-full overflow-hidden">
            {selectedElement && selectedAnnotation && extractionId ? (
              <ElementDetailView
                element={selectedElement}
                extractionId={extractionId}
                screenshotId={selectedAnnotation.screenshot_id}
                viewportWidth={selectedAnnotation.viewport_width}
                viewportHeight={selectedAnnotation.viewport_height}
              />
            ) : (
              <div className="h-full flex items-center justify-center p-4">
                <div className="text-center text-muted-foreground">
                  <Component className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select an element to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
