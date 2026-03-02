import Image from "next/image";
import type { DiffRegion } from "@/services/testing-service";
import { DiffRegionOverlay } from "./DiffRegionOverlay";

interface SwipeViewProps {
  baselineUrl: string;
  screenshotUrl: string;
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  zoom: number;
  swipePosition: number;
}

export function SwipeView({
  baselineUrl,
  screenshotUrl,
  diffRegions,
  showDiffRegions,
  zoom,
  swipePosition,
}: SwipeViewProps) {
  return (
    <div className="relative p-4">
      <div
        className="relative overflow-hidden"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        <Image
          src={screenshotUrl}
          alt="Screenshot"
          width={800}
          height={600}
          className="w-full h-auto"
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - swipePosition}% 0 0)` }}
        >
          <Image
            src={baselineUrl}
            alt="Baseline"
            width={800}
            height={600}
            className="w-full h-auto"
          />
        </div>
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary"
          style={{ left: `${swipePosition}%` }}
        />
        <DiffRegionOverlay
          diffRegions={diffRegions}
          showDiffRegions={showDiffRegions}
          zoom={zoom}
        />
      </div>
    </div>
  );
}
