import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { DiffRegion } from "@/services/testing-service";
import { DiffRegionOverlay } from "./DiffRegionOverlay";

interface SideBySideViewProps {
  baselineUrl: string | null;
  screenshotUrl: string | null;
  diffUrl?: string | null;
  diffRegions: DiffRegion[];
  showDiffRegions: boolean;
  zoom: number;
  onDownload: (url: string, name: string) => void;
}

export function SideBySideView({
  baselineUrl,
  screenshotUrl,
  diffUrl,
  diffRegions,
  showDiffRegions,
  zoom,
  onDownload,
}: SideBySideViewProps) {
  return (
    <div className="flex gap-4 p-4">
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Baseline</span>
          {baselineUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownload(baselineUrl, "baseline")}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="relative overflow-hidden rounded-lg border bg-background">
          {baselineUrl ? (
            <div
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
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              No baseline
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Screenshot</span>
          {screenshotUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownload(screenshotUrl, "screenshot")}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="relative overflow-hidden rounded-lg border bg-background">
          {screenshotUrl ? (
            <div
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
              <DiffRegionOverlay
                diffRegions={diffRegions}
                showDiffRegions={showDiffRegions}
                zoom={zoom}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-muted-foreground">
              No screenshot
            </div>
          )}
        </div>
      </div>

      {diffUrl && (
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Diff</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDownload(diffUrl, "diff")}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
          <div className="relative overflow-hidden rounded-lg border bg-background">
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              <Image
                src={diffUrl}
                alt="Diff"
                width={800}
                height={600}
                className="w-full h-auto"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
