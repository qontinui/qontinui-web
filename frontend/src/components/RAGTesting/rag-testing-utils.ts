/**
 * Pure utility functions for RAG Testing.
 * No hooks or React state — only pure transformations.
 */

import type {
  RAGFindMatch,
  SegmentWithMatches,
  BoundingBox,
} from "@/types/rag-testing";

// Runner API base URL (for SAM3 segmentation and RAG matching)
// Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
export const RUNNER_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

/** Score color based on confidence */
export function getScoreColor(score: number): string {
  if (score >= 0.8) return "#00FF88"; // Green - high confidence
  if (score >= 0.6) return "#FFD700"; // Yellow - medium confidence
  if (score >= 0.4) return "#FF6B6B"; // Red - low confidence
  return "#808080"; // Gray - very low/no match
}

/** Format score as percentage */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return "N/A";
  return `${(score * 100).toFixed(1)}%`;
}

/** Convert hex color string to RGB components */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result && result[1] && result[2] && result[3]
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 128, g: 128, b: 128 };
}

/** Convert image URL to base64 data URL */
export function urlToBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

/** Raw runner segment shape returned from the segmentation API */
export interface RunnerSegment {
  id: string;
  bbox: number[];
  area: number;
  image_base64?: string;
}

/** Convert runner segments to the internal SegmentWithMatches format */
export function processRunnerSegments(
  runnerSegments: RunnerSegment[]
): SegmentWithMatches[] {
  return runnerSegments.map((seg, idx) => {
    const [x, y, width, height] = seg.bbox;
    return {
      id: seg.id || `segment_${idx}`,
      bbox: {
        x: x ?? 0,
        y: y ?? 0,
        width: width ?? 0,
        height: height ?? 0,
      },
      mask_density: 1.0, // Runner segments are already filtered
      mask_data: seg.image_base64
        ? `data:image/png;base64,${seg.image_base64}`
        : null,
      text_description: null, // Runner doesn't provide text description
      matches: [],
      bestMatch: null,
    };
  });
}

/** Associate RAG matches with segments by bounding-box overlap */
export function associateMatchesWithSegments(
  processedSegments: SegmentWithMatches[],
  matches: RAGFindMatch[]
): SegmentWithMatches[] {
  return processedSegments.map((seg) => {
    // Find matches for this segment (by bbox overlap)
    const segMatches = matches.filter((match) => {
      const mb = match.bounding_box;
      const sb = seg.bbox;
      // Check if bounding boxes overlap significantly
      const overlapX = Math.max(
        0,
        Math.min(mb.x + mb.width, sb.x + sb.width) - Math.max(mb.x, sb.x)
      );
      const overlapY = Math.max(
        0,
        Math.min(mb.y + mb.height, sb.y + sb.height) - Math.max(mb.y, sb.y)
      );
      const overlapArea = overlapX * overlapY;
      const segArea = sb.width * sb.height;
      return overlapArea > segArea * 0.5; // 50% overlap threshold
    });

    // Sort by score and get best match
    segMatches.sort((a, b) => b.score - a.score);

    return {
      ...seg,
      matches: segMatches,
      bestMatch: segMatches[0] || null,
    };
  });
}

/** Check if a point is inside a bounding box */
export function isPointInBBox(
  point: { x: number; y: number },
  bbox: BoundingBox
): boolean {
  return (
    point.x >= bbox.x &&
    point.x <= bbox.x + bbox.width &&
    point.y >= bbox.y &&
    point.y <= bbox.y + bbox.height
  );
}
