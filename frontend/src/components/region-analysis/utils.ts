import type { RegionAnalysisResponse } from "@/services/regionAnalysis";
import { toast } from "sonner";

const SOURCE_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // yellow
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export function getColorForSource(_source: string, index: number): string {
  return (SOURCE_COLORS[index % SOURCE_COLORS.length] ??
    SOURCE_COLORS[0]) as string;
}

export function exportResultsAsJson(results: RegionAnalysisResponse) {
  const dataStr = JSON.stringify(results, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `region_analysis_results_${results.annotation_set_id}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Results exported");
}
