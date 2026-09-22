"use client";

import { useState, useEffect, useCallback } from "react";
import {
  cropFromImage,
  useCroppedExtractionScreenshot,
} from "./useCroppedExtractionScreenshot";
import type {
  BoundingBox,
  ElementAnnotation,
  ViewMode,
} from "../state-image-modal-types";

interface UseStateImageCropperParams {
  isOpen: boolean;
  extractionId: string;
  screenshotId: string;
  stateBbox: BoundingBox;
}

export function useStateImageCropper({
  isOpen,
  extractionId,
  screenshotId,
  stateBbox,
}: UseStateImageCropperParams) {
  // Closed: load nothing (the hook revokes the previous screenshot).
  const { fullImageUrl, croppedImageUrl, image, error, loading } =
    useCroppedExtractionScreenshot(
      extractionId,
      isOpen ? screenshotId : null,
      stateBbox,
      {
        outOfBounds:
          "State is outside the captured screenshot area. The state is at Y={y}px but the screenshot is only {height}px tall.",
        noVisibleArea: "State region has no visible area in the screenshot",
      }
    );

  const [viewMode, setViewMode] = useState<ViewMode>("state");
  const [selectedElement, setSelectedElement] =
    useState<ElementAnnotation | null>(null);
  const [elementImageUrl, setElementImageUrl] = useState<string | null>(null);

  const handleElementClick = useCallback(
    (element: ElementAnnotation) => {
      setSelectedElement(element);
      setViewMode("element");
      setElementImageUrl(image ? cropFromImage(image, element.bbox) : null);
    },
    [image]
  );

  const handleBackToState = useCallback(() => {
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
  }, []);

  useEffect(() => {
    if (isOpen) return;
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
  }, [isOpen]);

  const currentBbox =
    viewMode === "element" && selectedElement
      ? selectedElement.bbox
      : stateBbox;
  const currentImageUrl =
    viewMode === "element" ? elementImageUrl : croppedImageUrl;

  return {
    croppedImageUrl,
    fullImageUrl,
    error,
    loading,
    viewMode,
    selectedElement,
    elementImageUrl,
    currentBbox,
    currentImageUrl,
    handleElementClick,
    handleBackToState,
  };
}
