/**
 * State Image List Component
 *
 * Displays a scrollable list of state images (cropped from screenshots).
 * Clicking an image selects it to show details in the right panel.
 */

"use client";

import { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import { runnerClient } from "@/lib/runner-client";

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StateAnnotation {
  id: string;
  name: string;
  bbox: BoundingBox;
  state_type: string;
  element_ids: string[];
}

interface StateImageListProps {
  states: StateAnnotation[];
  extractionId: string;
  screenshotId: string;
  selectedStateId: string | null;
  onSelectState: (stateId: string) => void;
}

function StateImageThumbnail({
  state,
  extractionId,
  screenshotId,
  isSelected,
  onClick,
}: {
  state: StateAnnotation;
  extractionId: string;
  screenshotId: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadAndCropImage() {
      try {
        setLoading(true);
        setError(null);

        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          screenshotId
        );

        if (!mounted) return;

        if (!result.success || !result.blob) {
          setError("Failed to load");
          setLoading(false);
          return;
        }

        // Cleanup previous blob
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }

        const fullUrl = URL.createObjectURL(result.blob);
        blobUrlRef.current = fullUrl;

        // Load and crop image
        const img = new Image();
        img.onload = () => {
          if (!mounted) return;

          const bbox = state.bbox;

          // Check bounds
          if (
            bbox.y >= img.height ||
            bbox.x >= img.width ||
            bbox.y + bbox.height <= 0 ||
            bbox.x + bbox.width <= 0
          ) {
            setError("Out of bounds");
            setLoading(false);
            return;
          }

          // Calculate visible portion
          const visibleBbox = {
            x: Math.max(0, bbox.x),
            y: Math.max(0, bbox.y),
            width: Math.min(bbox.width, img.width - Math.max(0, bbox.x)),
            height: Math.min(bbox.height, img.height - Math.max(0, bbox.y)),
          };

          if (visibleBbox.width <= 0 || visibleBbox.height <= 0) {
            setError("No visible area");
            setLoading(false);
            return;
          }

          // Crop
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
            setImageUrl(canvas.toDataURL("image/png"));
          }

          setLoading(false);
        };

        img.onerror = () => {
          if (!mounted) return;
          setError("Failed to process");
          setLoading(false);
        };

        img.src = fullUrl;
      } catch (_e) {
        if (!mounted) return;
        setError("Error loading");
        setLoading(false);
      }
    }

    loadAndCropImage();

    return () => {
      mounted = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [
    extractionId,
    screenshotId,
    state.bbox.x,
    state.bbox.y,
    state.bbox.width,
    state.bbox.height,
  ]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-2 rounded-lg transition-all text-left ${
        isSelected
          ? "bg-brand-primary/20 ring-2 ring-brand-primary"
          : "hover:bg-muted/80"
      }`}
      title={state.name}
    >
      {/* Image */}
      <div className="aspect-[16/10] rounded-md overflow-hidden bg-muted mb-2 flex items-center justify-center">
        {loading ? (
          <ImageIcon className="h-6 w-6 text-muted-foreground animate-pulse" />
        ) : error || !imageUrl ? (
          <div className="flex flex-col items-center gap-1">
            <AlertCircle className="h-5 w-5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{error}</span>
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={state.name}
            className="w-full h-full object-contain"
            style={{ imageRendering: "crisp-edges" }}
          />
        )}
      </div>

      {/* Info */}
      <p className="text-xs font-medium truncate" title={state.name}>
        {state.name}
      </p>
      <p className="text-[10px] text-muted-foreground">
        {state.bbox.width}×{state.bbox.height}
      </p>
    </button>
  );
}

export function StateImageList({
  states,
  extractionId,
  screenshotId,
  selectedStateId,
  onSelectState,
}: StateImageListProps) {
  if (states.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">No states</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {states.map((state) => (
          <StateImageThumbnail
            key={state.id}
            state={state}
            extractionId={extractionId}
            screenshotId={screenshotId}
            isSelected={selectedStateId === state.id}
            onClick={() => onSelectState(state.id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
