import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Grid3x3 } from "lucide-react";
import type {
  RegionAnalysisResponse,
  FusedRegion,
  DetectedRegion,
} from "@/services/regionAnalysis";

interface RegionDetailsPanelProps {
  results: RegionAnalysisResponse;
  regionsToDisplay: (FusedRegion | DetectedRegion)[];
  totalGridCells: number;
  selectedRegion: FusedRegion | DetectedRegion | null;
  onSelectRegion: (region: FusedRegion | DetectedRegion) => void;
}

export function RegionDetailsPanel({
  results,
  regionsToDisplay,
  totalGridCells,
  selectedRegion,
  onSelectRegion,
}: RegionDetailsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Region Details</CardTitle>
        <CardDescription>Click a region to view details</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-2">
            <ScrollArea className="h-96">
              {regionsToDisplay.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No regions detected
                </p>
              ) : (
                <div className="space-y-2">
                  {regionsToDisplay.map((region, index) => {
                    const isFused = "votes" in region;
                    const hasGrid =
                      region.grid_metadata &&
                      region.grid_metadata.cells.length > 0;
                    return (
                      <button
                        key={index}
                        onClick={() => onSelectRegion(region)}
                        className={`w-full text-left p-3 rounded border transition-colors ${
                          selectedRegion === region
                            ? "border-primary bg-accent"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <div className="font-medium flex items-center gap-2">
                            {region.label ||
                              region.region_type ||
                              `Region ${index + 1}`}
                            {hasGrid && (
                              <Badge variant="secondary" className="text-xs">
                                <Grid3x3 className="h-3 w-3 mr-1" />
                                {region.grid_metadata!.rows}×
                                {region.grid_metadata!.cols}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {isFused && (
                              <Badge variant="secondary" className="text-xs">
                                {(region as FusedRegion).votes} votes
                              </Badge>
                            )}
                            <Badge
                              variant={
                                region.confidence > 0.7
                                  ? "default"
                                  : region.confidence > 0.4
                                    ? "secondary"
                                    : "outline"
                              }
                              className="text-xs"
                            >
                              {(region.confidence * 100).toFixed(0)}%
                            </Badge>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          {Math.round(region.bounding_box.width)} ×{" "}
                          {Math.round(region.bounding_box.height)}px
                          {hasGrid &&
                            ` • ${region.grid_metadata!.cells.length} cells`}
                        </div>

                        {isFused &&
                          (region as FusedRegion).sources.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(region as FusedRegion).sources.map((source) => (
                                <Badge
                                  key={source}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {source}
                                </Badge>
                              ))}
                            </div>
                          )}
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="stats" className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">Per-Analyzer Results</div>
              {results.analyzer_results.map((result) => (
                <div
                  key={result.analyzer_name}
                  className="flex items-center justify-between p-2 border rounded"
                >
                  <div className="text-sm">{result.analyzer_name}</div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{result.regions.length}</Badge>
                    <Badge variant="outline">
                      {(result.confidence * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="text-sm font-medium">Grid Statistics</div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Total Grids
                  </span>
                  <Badge variant="outline">
                    {regionsToDisplay.filter((r) => r.grid_metadata).length}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Total Cells
                  </span>
                  <Badge variant="outline">{totalGridCells}</Badge>
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="text-sm font-medium">Confidence Distribution</div>
              {["High (>70%)", "Medium (40-70%)", "Low (<40%)"].map(
                (range, i) => {
                  const count = regionsToDisplay.filter((r) => {
                    if (i === 0) return r.confidence > 0.7;
                    if (i === 1)
                      return r.confidence >= 0.4 && r.confidence <= 0.7;
                    return r.confidence < 0.4;
                  }).length;
                  return (
                    <div
                      key={range}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">
                        {range}
                      </span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  );
                }
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
