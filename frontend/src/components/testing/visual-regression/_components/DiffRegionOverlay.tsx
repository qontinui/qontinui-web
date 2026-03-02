import type { DiffRegion } from "@/services/testing-service";

interface DiffRegionOverlayProps {
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  zoom: number;
}

export function DiffRegionOverlay({
  diffRegions,
  showDiffRegions,
  zoom,
}: DiffRegionOverlayProps) {
  if (!showDiffRegions || diffRegions.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {diffRegions.map((region, index) => (
        <div
          key={index}
          className="absolute border-2 border-red-500 bg-red-500/20"
          style={{
            left: `${region.x}px`,
            top: `${region.y}px`,
            width: `${region.width}px`,
            height: `${region.height}px`,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
          title={`Change: ${(region.change_percentage * 100).toFixed(1)}%`}
        />
      ))}
    </div>
  );
}
