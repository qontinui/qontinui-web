import type { ExtractedPattern } from "@/types/pattern-optimization";

export function exportPattern(
  pattern: ExtractedPattern,
  sessionId: string | undefined
): void {
  const exportData = {
    pattern: {
      id: pattern.id,
      name: pattern.name,
      dimensions: { width: pattern.width, height: pattern.height },
      statistics: {
        maskDensity: pattern.maskDensity,
        activePixels: pattern.activePixels,
        totalPixels: pattern.totalPixels,
        confidence: {
          min: pattern.minConfidence,
          max: pattern.maxConfidence,
          avg: pattern.avgConfidence,
          stdDev: pattern.stdDevConfidence,
        },
      },
      config: pattern.config,
      images: {
        pattern: pattern.patternImage,
        confidence: pattern.confidenceMap,
        mask: pattern.maskImage,
      },
    },
    metadata: {
      createdAt: pattern.createdAt,
      sourceScreenshots: pattern.sourceScreenshotIds.length,
      sessionId,
    },
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

  const filename = `pattern-${pattern.name}-${Date.now()}.json`;

  const link = document.createElement("a");
  link.setAttribute("href", dataUri);
  link.setAttribute("download", filename);
  link.click();

  console.log("[PatternOptimization] Exported pattern:", pattern.id);
}
