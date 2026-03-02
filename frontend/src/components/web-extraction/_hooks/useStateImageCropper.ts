"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { runnerClient } from "@/lib/runner-client";
import type {
  BoundingBox,
  ElementAnnotation,
  ViewMode,
} from "../state-image-modal-types";

function clampBbox(bbox: BoundingBox, imgWidth: number, imgHeight: number) {
  const x = Math.max(0, bbox.x);
  const y = Math.max(0, bbox.y);
  return {
    x,
    y,
    width: Math.min(bbox.width, imgWidth - x),
    height: Math.min(bbox.height, imgHeight - y),
  };
}

function cropFromImage(
  img: HTMLImageElement,
  bbox: BoundingBox
): string | null {
  if (
    bbox.x >= img.width ||
    bbox.y >= img.height ||
    bbox.width <= 0 ||
    bbox.height <= 0
  ) {
    return null;
  }

  const visibleBbox = clampBbox(bbox, img.width, img.height);
  if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = visibleBbox.width;
  canvas.height = visibleBbox.height;
  const ctx = canvas.getContext("2d");

  if (!ctx) return null;

  ctx.drawImage(
    img,
    visibleBbox.x,
    visibleBbox.y,
    visibleBbox.width,
    visibleBbox.height,
    0,
    0,
    visibleBbox.width,
    visibleBbox.height
  );
  return canvas.toDataURL("image/png");
}

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
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("state");
  const [selectedElement, setSelectedElement] =
    useState<ElementAnnotation | null>(null);
  const [elementImageUrl, setElementImageUrl] = useState<string | null>(null);

  const blobUrlRef = useRef<string | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  const cleanupBlobUrl = useCallback(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const handleElementClick = useCallback((element: ElementAnnotation) => {
    setSelectedElement(element);
    setViewMode("element");

    const img = loadedImageRef.current;
    setElementImageUrl(img ? cropFromImage(img, element.bbox) : null);
  }, []);

  const handleBackToState = useCallback(() => {
    setViewMode("state");
    setSelectedElement(null);
    setElementImageUrl(null);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanupBlobUrl();
      setCroppedImageUrl(null);
      setFullImageUrl(null);
      setError(null);
      setLoading(true);
      setViewMode("state");
      setSelectedElement(null);
      setElementImageUrl(null);
      loadedImageRef.current = null;
      return;
    }

    let mounted = true;

    async function loadAndCropScreenshot() {
      try {
        setLoading(true);
        setError(null);

        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          screenshotId
        );

        if (!mounted) return;

        if (!result.success || !result.blob) {
          setError(result.error || "Failed to load screenshot");
          setLoading(false);
          return;
        }

        cleanupBlobUrl();

        const fullUrl = URL.createObjectURL(result.blob);
        blobUrlRef.current = fullUrl;
        setFullImageUrl(fullUrl);

        const img = new Image();

        img.onload = () => {
          if (!mounted) return;

          loadedImageRef.current = img;

          const isOutOfBounds =
            stateBbox.y >= img.height ||
            stateBbox.x >= img.width ||
            stateBbox.y + stateBbox.height <= 0 ||
            stateBbox.x + stateBbox.width <= 0;

          if (isOutOfBounds) {
            setError(
              `State is outside the captured screenshot area. The state is at Y=${stateBbox.y}px but the screenshot is only ${img.height}px tall.`
            );
            setLoading(false);
            return;
          }

          const croppedUrl = cropFromImage(img, stateBbox);
          if (croppedUrl) {
            setCroppedImageUrl(croppedUrl);
          } else {
            setError("State region has no visible area in the screenshot");
          }

          setLoading(false);
        };

        img.onerror = () => {
          if (!mounted) return;
          setError("Failed to process screenshot");
          setLoading(false);
        };

        img.src = fullUrl;
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : "Failed to load screenshot");
        setLoading(false);
      }
    }

    loadAndCropScreenshot();

    return () => {
      mounted = false;
    };
  }, [
    isOpen,
    extractionId,
    screenshotId,
    stateBbox.x,
    stateBbox.y,
    stateBbox.width,
    stateBbox.height,
    cleanupBlobUrl,
  ]);

  useEffect(() => {
    return () => {
      cleanupBlobUrl();
    };
  }, [cleanupBlobUrl]);

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
