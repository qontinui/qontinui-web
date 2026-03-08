"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SettingsCardProps } from "../settings-types";

export function AnalysisSettingsCard({
  settings,
  updateSetting,
}: SettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analysis Settings</CardTitle>
        <CardDescription>
          Color analysis and clustering configuration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="kmeans_clusters">K-Means Clusters</Label>
          <Input
            id="kmeans_clusters"
            type="number"
            value={settings.analysis.kmeans_clusters}
            onChange={(e) =>
              updateSetting(
                "analysis",
                "kmeans_clusters",
                parseInt(e.target.value)
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="color_tolerance">Color Tolerance (0-255)</Label>
          <Input
            id="color_tolerance"
            type="number"
            value={settings.analysis.color_tolerance}
            onChange={(e) =>
              updateSetting(
                "analysis",
                "color_tolerance",
                parseInt(e.target.value)
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="min_contour_area">Min Contour Area</Label>
          <Input
            id="min_contour_area"
            type="number"
            value={settings.analysis.min_contour_area}
            onChange={(e) =>
              updateSetting(
                "analysis",
                "min_contour_area",
                parseInt(e.target.value)
              )
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="max_contour_area">Max Contour Area</Label>
          <Input
            id="max_contour_area"
            type="number"
            value={settings.analysis.max_contour_area}
            onChange={(e) =>
              updateSetting(
                "analysis",
                "max_contour_area",
                parseInt(e.target.value)
              )
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
