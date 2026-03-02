"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStateImageCropper } from "./_hooks/useStateImageCropper";
import { StateImageDisplay } from "./_components/StateImageDisplay";
import { StateImageDetails } from "./_components/StateImageDetails";
import type { StateImageModalProps } from "./state-image-modal-types";

export type {
  BoundingBox,
  ElementAnnotation,
  StateAnnotation,
  StateImageModalProps,
} from "./state-image-modal-types";

export function StateImageModal({
  isOpen,
  onClose,
  state,
  elements,
  extractionId,
  screenshotId,
  viewportWidth,
  viewportHeight,
}: StateImageModalProps) {
  const {
    fullImageUrl,
    error,
    loading,
    viewMode,
    selectedElement,
    currentBbox,
    currentImageUrl,
    handleElementClick,
    handleBackToState,
  } = useStateImageCropper({
    isOpen,
    extractionId,
    screenshotId,
    stateBbox: state.bbox,
  });

  const stateElements = useMemo(
    () => elements.filter((el) => state.element_ids.includes(el.id)),
    [elements, state.element_ids]
  );

  const currentTitle =
    viewMode === "element" && selectedElement
      ? selectedElement.name || selectedElement.id
      : state.name;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        data-ui-id="dialog-state-image"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {viewMode === "element" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 mr-1"
                onClick={handleBackToState}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <ImageIcon className="h-5 w-5" />
            {currentTitle}
            <Badge variant="outline" className="ml-2">
              {viewMode === "element" && selectedElement
                ? selectedElement.element_type
                : state.state_type}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {viewMode === "element"
              ? "Element region from extraction screenshot"
              : "State region from extraction screenshot"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex gap-4">
          <StateImageDisplay
            loading={loading}
            error={error}
            fullImageUrl={fullImageUrl}
            currentImageUrl={currentImageUrl}
            currentTitle={currentTitle}
            currentBbox={currentBbox}
            viewMode={viewMode}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
          />

          <StateImageDetails
            state={state}
            elements={elements}
            stateElements={stateElements}
            viewMode={viewMode}
            selectedElement={selectedElement}
            currentBbox={currentBbox}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            onElementClick={handleElementClick}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
