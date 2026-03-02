"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { runnerClient } from "@/lib/runner-client";
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
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFullImage, setShowFullImage] = useState(false);

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

  const cropElement = useCallback((element: ElementAnnotation) => {
    const img = loadedImageRef.current;
    if (!img) return null;

    const bbox = element.bbox;

    if (
      bbox.x >= img.width ||
      bbox.y >= img.height ||
      bbox.width <= 0 ||
      bbox.height <= 0
    ) {
      return null;
    }

    const visibleBbox = {
      x: Math.max(0, bbox.x),
      y: Math.max(0, bbox.y),
      width: Math.min(bbox.width, img.width - Math.max(0, bbox.x)),
      height: Math.min(bbox.height, img.height - Math.max(0, bbox.y)),
    };

    if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = visibleBbox.width;
    canvas.height = visibleBbox.height;
    const ctx = canvas.getContext("2d");

    if (ctx) {
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
    return null;
  }, []);

  const handleElementClick = useCallback(
    (element: ElementAnnotation) => {
      setSelectedElement(element);
      setViewMode("element");
      const croppedUrl = cropElement(element);
      setElementImageUrl(croppedUrl);
    },
    [cropElement]
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

  useEffect(() => {
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

          const visibleBbox = {
            x: Math.max(0, stateBbox.x),
            y: Math.max(0, stateBbox.y),
            width: Math.min(
              stateBbox.width,
              img.width - Math.max(0, stateBbox.x)
            ),
            height: Math.min(
              stateBbox.height,
              img.height - Math.max(0, stateBbox.y)
            ),
          };

          visibleBbox.width = Math.min(
            visibleBbox.width,
            img.width - visibleBbox.x
          );
          visibleBbox.height = Math.min(
            visibleBbox.height,
            img.height - visibleBbox.y
          );

          if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
            setError("State region has no visible area in the screenshot");
            setLoading(false);
            return;
          }

          const canvas = document.createElement("canvas");
          canvas.width = visibleBbox.width;
          canvas.height = visibleBbox.height;
          const ctx = canvas.getContext("2d");

          if (ctx) {
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

            const croppedUrl = canvas.toDataURL("image/png");
            setCroppedImageUrl(croppedUrl);
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
    extractionId,
    screenshotId,
    stateBbox.x,
    stateBbox.y,
    stateBbox.width,
    stateBbox.height,
    stateId,
    cleanupBlobUrl,
  ]);

  useEffect(() => {
    return () => {
      cleanupBlobUrl();
    };
  }, [cleanupBlobUrl]);

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
