import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Grid3x3, Info } from "lucide-react";
import type { FusedRegion, DetectedRegion } from "@/services/regionAnalysis";

interface SelectedRegionDetailsProps {
  region: FusedRegion | DetectedRegion;
}

export function SelectedRegionDetails({ region }: SelectedRegionDetailsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          Selected Region Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium">Label</div>
              <div className="text-sm text-muted-foreground">
                {region.label || "N/A"}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Type</div>
              <div className="text-sm text-muted-foreground">
                {region.region_type || "N/A"}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Confidence</div>
              <div className="text-sm text-muted-foreground">
                {(region.confidence * 100).toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Position</div>
              <div className="text-sm text-muted-foreground">
                ({Math.round(region.bounding_box.x)},{" "}
                {Math.round(region.bounding_box.y)})
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Size</div>
              <div className="text-sm text-muted-foreground">
                {Math.round(region.bounding_box.width)} ×{" "}
                {Math.round(region.bounding_box.height)}px
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Area</div>
              <div className="text-sm text-muted-foreground">
                {Math.round(
                  region.bounding_box.width * region.bounding_box.height
                )}{" "}
                px²
              </div>
            </div>
          </div>

          {region.grid_metadata && (
            <>
              <Separator />
              <div>
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Grid3x3 className="h-4 w-4" />
                  Grid Information
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-medium">Grid Size</div>
                    <div className="text-sm text-muted-foreground">
                      {region.grid_metadata.rows} rows ×{" "}
                      {region.grid_metadata.cols} columns
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium">Total Cells</div>
                    <div className="text-sm text-muted-foreground">
                      {region.grid_metadata.cells.length}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium">Cell Size</div>
                    <div className="text-sm text-muted-foreground">
                      {Math.round(region.grid_metadata.cell_width)} ×{" "}
                      {Math.round(region.grid_metadata.cell_height)}
                      px
                    </div>
                  </div>
                  {region.grid_metadata.horizontal_spacing !== undefined && (
                    <div>
                      <div className="text-sm font-medium">Spacing</div>
                      <div className="text-sm text-muted-foreground">
                        H: {Math.round(region.grid_metadata.horizontal_spacing)}
                        px, V:{" "}
                        {Math.round(region.grid_metadata.vertical_spacing || 0)}
                        px
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {"votes" in region && (
            <>
              <Separator />
              <div>
                <div className="text-sm font-medium mb-2">
                  Source Confidences
                </div>
                <div className="space-y-1">
                  {Object.entries(
                    (region as FusedRegion).source_confidences
                  ).map(([source, conf]) => (
                    <div
                      key={source}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">
                        {source}
                      </span>
                      <Badge variant="outline">
                        {(conf * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {region.metadata && Object.keys(region.metadata).length > 0 && (
            <>
              <Separator />
              <div>
                <div className="text-sm font-medium mb-2">Metadata</div>
                <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                  {JSON.stringify(region.metadata, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
