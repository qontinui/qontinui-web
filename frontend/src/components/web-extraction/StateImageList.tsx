/**
 * State Image List Component
 *
 * Displays a scrollable list of state images (cropped from screenshots).
 * Clicking an image selects it to show details in the right panel.
 */

"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import { useCroppedExtractionScreenshot } from "./_hooks/useCroppedExtractionScreenshot";

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
  const {
    croppedImageUrl: imageUrl,
    error,
    loading,
  } = useCroppedExtractionScreenshot(extractionId, screenshotId, state.bbox, {
    outOfBounds: "Out of bounds",
    noVisibleArea: "No visible area",
  });

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
          // eslint-disable-next-line @next/next/no-img-element
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
