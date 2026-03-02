import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { RegionAnalysisResponse } from "@/services/regionAnalysis";
import { exportResultsAsJson } from "../utils";

interface SummaryCardProps {
  results: RegionAnalysisResponse;
}

export function SummaryCard({ results }: SummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Region Analysis Summary</CardTitle>
        <CardDescription>
          Results from {results.analyzer_results.length} analyzer(s)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <div className="text-2xl font-bold">
              {results.fused_regions?.length || 0}
            </div>
            <div className="text-xs text-muted-foreground">Fused Regions</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {results.analyzer_results.reduce(
                (sum, r) => sum + r.regions.length,
                0
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Total Detections
            </div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {results.fusion_stats?.total_grid_cells || 0}
            </div>
            <div className="text-xs text-muted-foreground">Grid Cells</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {results.fusion_stats?.avg_confidence.toFixed(2) || "N/A"}
            </div>
            <div className="text-xs text-muted-foreground">Avg Confidence</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {results.fusion_stats?.multi_vote_regions || 0}
            </div>
            <div className="text-xs text-muted-foreground">Multi-Vote</div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            onClick={() => exportResultsAsJson(results)}
            variant="outline"
            size="sm"
          >
            <Download className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
