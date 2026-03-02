"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type {
  ElementAnnotation,
  StateAnnotation,
} from "./state-image-modal-types";
import { useStateDetailsImage } from "./_hooks/useStateDetailsImage";
import { StateDetailsPanelHeader } from "./_components/StateDetailsPanelHeader";
import { StateDetailsPanelImageSection } from "./_components/StateDetailsPanelImageSection";
import { PositionSizeInfo } from "./_components/PositionSizeInfo";
import { StateElementsList } from "./_components/StateElementsList";
import { StateDetailsMetadata } from "./_components/StateDetailsMetadata";

interface StateDetailsPanelProps {
  state: StateAnnotation;
  elements: ElementAnnotation[];
  extractionId: string;
  screenshotId: string;
  viewportWidth: number;
  viewportHeight: number;
}

export function StateDetailsPanel({
  state,
  elements,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: StateDetailsPanelProps) {
  const {
    croppedImageUrl,
    fullImageUrl,
    error,
    loading,
    showFullImage,
    setShowFullImage,
    viewMode,
    selectedElement,
    elementImageUrl,
    handleElementClick,
    handleBackToState,
  } = useStateDetailsImage({
    extractionId,
    screenshotId,
    stateBbox: state.bbox,
    stateId: state.id,
  });

  const stateElements = elements.filter((el) =>
    state.element_ids.includes(el.id)
  );

  const currentBbox =
    viewMode === "element" && selectedElement
      ? selectedElement.bbox
      : state.bbox;
  const currentImageUrl =
    viewMode === "element" ? elementImageUrl : croppedImageUrl;
  const currentTitle =
    viewMode === "element" && selectedElement
      ? selectedElement.name || selectedElement.id
      : state.name;
  const currentTypeBadge =
    viewMode === "element" && selectedElement
      ? selectedElement.element_type
      : state.state_type;

  return (
    <div className="h-full flex flex-col">
      <StateDetailsPanelHeader
        viewMode={viewMode}
        title={currentTitle}
        typeBadge={currentTypeBadge}
        onBackToState={handleBackToState}
      />

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          <StateDetailsPanelImageSection
            loading={loading}
            error={error}
            showFullImage={showFullImage}
            onToggleFullImage={() => setShowFullImage(!showFullImage)}
            fullImageUrl={fullImageUrl}
            currentImageUrl={currentImageUrl}
            currentTitle={currentTitle}
            currentBbox={currentBbox}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            viewMode={viewMode}
          />

          <Separator />

          <PositionSizeInfo bbox={currentBbox} />

          <Separator />

          <StateElementsList
            elements={stateElements}
            selectedElementId={selectedElement?.id ?? null}
            onElementClick={handleElementClick}
          />

          {viewMode === "element" && selectedElement?.text && (
            <>
              <Separator />
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">Text:</span>
                <p className="text-xs bg-muted rounded px-2 py-1.5 break-words">
                  {selectedElement.text}
                </p>
              </div>
            </>
          )}

          <Separator />

          <StateDetailsMetadata
            viewMode={viewMode}
            stateId={state.id}
            selectedElementId={selectedElement?.id ?? null}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
