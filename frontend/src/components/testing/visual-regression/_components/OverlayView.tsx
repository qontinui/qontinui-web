import Image from "next/image";
import type { DiffRegion } from "@/services/testing-service";
import { DiffRegionOverlay } from "./DiffRegionOverlay";

interface OverlayViewProps {
  baselineUrl: string;
  screenshotUrl: string;
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  zoom: number;
  overlayOpacity: number;
}

export function OverlayView({
  baselineUrl,
  screenshotUrl,
  diffRegions,
  showDiffRegions,
  zoom,
  overlayOpacity,
}: OverlayViewProps) {
  return (
    <div className="relative p-4">
      <div
        className="relative"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        <Image
          src={baselineUrl}
          alt="Baseline"
          width={800}
          height={600}
          className="w-full h-auto"
        />
        <div className="absolute inset-0" style={{ opacity: overlayOpacity }}>
          <Image
            src={screenshotUrl}
            alt="Screenshot"
            width={800}
            height={600}
            className="w-full h-auto"
          />
        </div>
        <DiffRegionOverlay
          diffRegions={diffRegions}
          showDiffRegions={showDiffRegions}
          zoom={zoom}
        />
      </div>
    </div>
  );
}
