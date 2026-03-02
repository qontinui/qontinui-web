import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, Layers, Grid3x3 } from "lucide-react";
import type {
  RegionAnalysisResponse,
  FusedRegion,
  DetectedRegion,
} from "@/services/regionAnalysis";
import { getColorForSource } from "../utils";
import { RegionOverlay } from "./RegionOverlay";

interface VisualizationCardProps {
  results: RegionAnalysisResponse;
  imageUrl?: string;
  imageWidth: number;
  imageHeight: number;
  selectedView: "fused" | "individual";
  setSelectedView: (v: "fused" | "individual") => void;
  selectedAnalyzer: string | null;
  setSelectedAnalyzer: (v: string) => void;
  showGridCells: boolean;
  setShowGridCells: (v: boolean) => void;
  showCellNumbers: boolean;
  setShowCellNumbers: (v: boolean) => void;
  zoom: number;
  setZoom: (v: number) => void;
  regionsToDisplay: (FusedRegion | DetectedRegion)[];
  totalGridCells: number;
  visibleSources: Set<string>;
  toggleSource: (source: string) => void;
}

export function VisualizationCard({
  results,
  imageUrl,
  imageWidth,
  imageHeight,
  selectedView,
  setSelectedView,
  selectedAnalyzer,
  setSelectedAnalyzer,
  showGridCells,
  setShowGridCells,
  showCellNumbers,
  setShowCellNumbers,
  zoom,
  setZoom,
  regionsToDisplay,
  totalGridCells,
  visibleSources,
  toggleSource,
}: VisualizationCardProps) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Visual Results</CardTitle>
            <CardDescription>
              {regionsToDisplay.length} region(s), {totalGridCells} cell(s)
            </CardDescription>
          </div>

          <div className="flex gap-2">
            <Select
              value={selectedView}
              onValueChange={(v: "fused" | "individual") => setSelectedView(v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fused">Fused Results</SelectItem>
                <SelectItem value="individual">Individual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Button
              variant={showGridCells ? "default" : "outline"}
              size="sm"
              onClick={() => setShowGridCells(!showGridCells)}
            >
              <Grid3x3 className="h-4 w-4 mr-2" />
              Grid Cells
            </Button>
            <Button
              variant={showCellNumbers ? "default" : "outline"}
              size="sm"
              onClick={() => setShowCellNumbers(!showCellNumbers)}
              disabled={!showGridCells}
            >
              Cell Numbers
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom(Math.min(zoom + 0.25, 3))}
            >
              Zoom +
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setZoom(Math.max(zoom - 0.25, 0.5))}
            >
              Zoom -
            </Button>
            <Button variant="outline" size="sm" onClick={() => setZoom(1)}>
              Reset
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {selectedView === "individual" && (
          <div className="mb-4">
            <Select
              value={selectedAnalyzer || ""}
              onValueChange={setSelectedAnalyzer}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select analyzer" />
              </SelectTrigger>
              <SelectContent>
                {results.analyzer_results.map((result) => (
                  <SelectItem
                    key={result.analyzer_name}
                    value={result.analyzer_name}
                  >
                    {result.analyzer_name} ({result.regions.length} regions)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="relative border rounded-lg overflow-auto bg-muted">
          {imageUrl ? (
            <div
              className="relative inline-block"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="Region analysis visualization"
                className="block"
                style={{ width: imageWidth, height: imageHeight }}
              />

              <RegionOverlay
                results={results}
                selectedView={selectedView}
                selectedAnalyzer={selectedAnalyzer}
                showGridCells={showGridCells}
                showCellNumbers={showCellNumbers}
                imageWidth={imageWidth}
                imageHeight={imageHeight}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-96">
              <div className="text-center text-muted-foreground">
                <Layers className="mx-auto h-12 w-12 mb-2" />
                <p>No image to display</p>
              </div>
            </div>
          )}
        </div>

        {selectedView === "fused" &&
          (results.fused_regions?.length || 0) > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="h-4 w-4" />
                <span className="text-sm font-medium">Sources</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from(
                  new Set(
                    results.fused_regions?.flatMap((r) => r.sources) || []
                  )
                ).map((source, index) => (
                  <Badge
                    key={source}
                    variant={visibleSources.has(source) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleSource(source)}
                    style={{
                      borderColor: getColorForSource(source, index),
                      backgroundColor: visibleSources.has(source)
                        ? getColorForSource(source, index)
                        : "transparent",
                    }}
                  >
                    {visibleSources.has(source) ? (
                      <Eye className="mr-1 h-3 w-3" />
                    ) : (
                      <EyeOff className="mr-1 h-3 w-3" />
                    )}
                    {source}
                  </Badge>
                ))}
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
