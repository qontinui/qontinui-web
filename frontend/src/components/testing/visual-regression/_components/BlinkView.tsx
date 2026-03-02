import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import type { DiffRegion } from "@/services/testing-service";
import { DiffRegionOverlay } from "./DiffRegionOverlay";

interface BlinkViewProps {
  baselineUrl: string | null;
  screenshotUrl: string | null;
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  zoom: number;
  blinkState: "baseline" | "screenshot";
}

export function BlinkView({
  baselineUrl,
  screenshotUrl,
  diffRegions,
  showDiffRegions,
  zoom,
  blinkState,
}: BlinkViewProps) {
  return (
    <div className="relative p-4">
      <div
        className="relative"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
        }}
      >
        {blinkState === "baseline" && baselineUrl ? (
          <Image
            src={baselineUrl}
            alt="Baseline"
            width={800}
            height={600}
            className="w-full h-auto"
          />
        ) : screenshotUrl ? (
          <>
            <Image
              src={screenshotUrl}
              alt="Screenshot"
              width={800}
              height={600}
              className="w-full h-auto"
            />
            <DiffRegionOverlay
              diffRegions={diffRegions}
              showDiffRegions={showDiffRegions}
              zoom={zoom}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-48 text-muted-foreground">
            No image
          </div>
        )}
      </div>
      <div className="absolute top-6 left-6">
        <Badge variant="outline">
          {blinkState === "baseline" ? "Baseline" : "Screenshot"}
        </Badge>
      </div>
    </div>
  );
}
