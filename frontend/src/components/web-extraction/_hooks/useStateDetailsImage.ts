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

interface UseStateDetailsImageParams {
  extractionId: string;
  screenshotId: string;
  stateBbox: BoundingBox;
  stateId: string;
}

interface UseStateDetailsImageResult {
  croppedImageUrl: string | null;
  fullImageUrl: string | null;
  error: string | null;
  loading: boolean;
  showFullImage: boolean;
  setShowFullImage: (show: boolean) => void;
  viewMode: ViewMode;
  selectedElement: ElementAnnotation | null;
  elementImageUrl: string | null;
  handleElementClick: (element: ElementAnnotation) => void;
  handleBackToState: () => void;
}

export function useStateDetailsImage({
  extractionId,
  screenshotId,
  stateBbox,
  stateId,
}: UseStateDetailsImageParams): UseStateDetailsImageResult {
  const { fullImageUrl, croppedImageUrl, image, error, loading } =
    useCroppedExtractionScreenshot(extractionId, screenshotId, stateBbox, {
      outOfBounds:
        "State is outside the captured screenshot area. The state is at Y={y}px but the screenshot is only {height}px tall.",
      noVisibleArea: "State region has no visible area in the screenshot",
    });
  const [showFullImage, setShowFullImage] = useState(false);

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
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
    setShowFullImage(false);
  }, [stateId]);

  return {
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
  };
}
