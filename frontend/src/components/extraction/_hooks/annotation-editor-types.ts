import type {
  AnnotatedElement,
  ReviewStatus,
} from "@/stores/extraction-annotation-store";

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const COLORS = {
  normal: { fill: "rgba(155, 89, 182, 0.15)", stroke: "#9B59B6" },
  selected: { fill: "rgba(155, 89, 182, 0.3)", stroke: "#9B59B6" },
  hovered: { fill: "rgba(155, 89, 182, 0.25)", stroke: "#9B59B6" },
  groundTruth: { fill: "rgba(39, 174, 96, 0.15)", stroke: "#27AE60" },
  groundTruthSelected: { fill: "rgba(39, 174, 96, 0.3)", stroke: "#27AE60" },
  drawing: { fill: "rgba(52, 152, 219, 0.2)", stroke: "#3498DB" },
  selectionBox: { fill: "rgba(52, 152, 219, 0.1)", stroke: "#3498DB" },
};

export const REVIEW_COLORS: Record<ReviewStatus, string> = {
  pending: "#F39C12",
  approved: "#27AE60",
  rejected: "#E74C3C",
  needs_revision: "#9B59B6",
};

export function isElementVisible(
  element: AnnotatedElement,
  viewport: Viewport
): boolean {
  const { x, y, width, height } = element.bbox;
  return !(
    x + width < viewport.x ||
    x > viewport.x + viewport.width ||
    y + height < viewport.y ||
    y > viewport.y + viewport.height
  );
}

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
