"use client";

import { useExtractionStore } from "@/stores/extraction-store";
import { cn } from "@/lib/utils";

export function LivePreview() {
  const previewScreenshotId = useExtractionStore(
    (state) => state.previewScreenshotId
  );
  const screenshots = useExtractionStore((state) => state.screenshots);
  const states = useExtractionStore((state) => state.states);
  const elements = useExtractionStore((state) => state.elements);
  const selectedStateId = useExtractionStore((state) => state.selectedStateId);
  const showStateBoundaries = useExtractionStore(
    (state) => state.showStateBoundaries
  );
  const showElementLabels = useExtractionStore(
    (state) => state.showElementLabels
  );
  const selectState = useExtractionStore((state) => state.selectState);

  const screenshot = previewScreenshotId
    ? screenshots.get(previewScreenshotId)
    : null;

  // Filter states/elements for current screenshot
  const visibleStates = states.filter(
    (s) => s.screenshotId === previewScreenshotId
  );

  if (!screenshot) {
    return (
      <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
        <p className="text-muted-foreground">
          {previewScreenshotId ? "Loading preview..." : "No preview available"}
        </p>
      </div>
    );
  }

  return (
    <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
      {/* Screenshot */}
      <img
        src={`data:image/png;base64,${screenshot.thumbnail}`}
        alt="Preview"
        className="w-full h-full object-contain"
      />

      {/* State overlays */}
      {showStateBoundaries &&
        visibleStates.map((state) => (
          <div
            key={state.id}
            className={cn(
              "absolute border-2 cursor-pointer transition-colors",
              selectedStateId === state.id
                ? "border-primary bg-primary/10"
                : "border-blue-500/50 hover:border-blue-500"
            )}
            style={{
              left: `${(state.bbox.x / 1920) * 100}%`,
              top: `${(state.bbox.y / 1080) * 100}%`,
              width: `${(state.bbox.width / 1920) * 100}%`,
              height: `${(state.bbox.height / 1080) * 100}%`,
            }}
            onClick={() => selectState(state.id)}
          >
            <span className="absolute -top-6 left-0 text-xs bg-blue-500 text-white px-1 rounded">
              {state.name}
            </span>
          </div>
        ))}
    </div>
  );
}
