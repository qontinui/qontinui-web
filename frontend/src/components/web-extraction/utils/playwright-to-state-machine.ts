/**
 * Utility functions to convert Playwright extraction results
 * to the standard StateMachine format used by other extraction methods.
 */

import type {
  StateMachineState,
  StateMachineStateImage,
  ExtractionAnnotation,
  ElementAnnotation,
  StateAnnotation,
  BoundingBox,
} from "@/types/extraction";
import type { PlaywrightExtractionResults } from "@/hooks/use-playwright-extraction";
import type { PlaywrightClickable } from "@/lib/runner-client";

/**
 * Extended clickable type that includes optional fields from the runner response.
 */
type ExtendedPlaywrightClickable = PlaywrightClickable & {
  source_url?: string;
};

/**
 * Result of converting Playwright results to state machine format.
 */
export interface PlaywrightToStateMachineResult {
  states: StateMachineState[];
  annotations: ExtractionAnnotation[];
  /** Map of screenshot_id to base64 images (element crops) */
  screenshotMap: Map<string, string>;
  /** Map of stateImage ID to base64 (for direct thumbnail display) */
  thumbnailMap: Map<string, string>;
}

/**
 * Derive a state name from a URL.
 */
function deriveStateName(url: string, index: number): string {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      // Capitalize and clean the last path segment
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart) {
        return lastPart
          .replace(/[-_]/g, " ")
          .replace(/\.[^.]+$/, "") // Remove file extension
          .split(" ")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }
    }
    // Use hostname for root paths
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return `Page ${index + 1}`;
  }
}

/**
 * Convert Playwright extraction results (from runner) to the standard state machine format.
 * This function accepts the direct results from the runner API.
 */
export function convertPlaywrightResultsToStateMachine(
  results: PlaywrightExtractionResults
): PlaywrightToStateMachineResult | null {
  if (!results.clickables || results.clickables.length === 0) {
    return null;
  }

  const clickables = results.clickables as ExtendedPlaywrightClickable[];
  const pagesVisited = results.pages_visited || [results.url || "unknown"];

  const states: StateMachineState[] = [];
  const annotations: ExtractionAnnotation[] = [];
  const screenshotMap = new Map<string, string>();
  const thumbnailMap = new Map<string, string>();

  // Group clickables by page
  const clickablesByPage = groupClickablesByPage(clickables, pagesVisited);

  let stateIndex = 0;

  for (const [url, pageClickables] of clickablesByPage) {
    if (pageClickables.length === 0) continue;

    const stateId = `playwright-state-${stateIndex}`;
    const screenshotId = `playwright-screenshot-${stateIndex}`;
    const stateName = deriveStateName(url, stateIndex);

    // Convert clickables to state images
    const stateImages: (StateMachineStateImage & { base64?: string })[] = [];
    const elementAnnotations: ElementAnnotation[] = [];
    const elementIds: string[] = [];

    for (const clickable of pageClickables) {
      // Generate element_id if not present
      const elementId = clickable.element_id || `element-${clickable.selector?.replace(/[^a-zA-Z0-9]/g, '-') || stateIndex}-${elementIds.length}`;

      // Create state image with embedded base64
      const stateImage = clickableToStateImage(clickable, screenshotId, elementId);
      stateImages.push(stateImage);

      // Store base64 for thumbnail display
      if (clickable.screenshot) {
        thumbnailMap.set(stateImage.id, clickable.screenshot);
      }

      // Create element annotation
      const element = clickableToElementAnnotation(clickable, elementId);
      elementAnnotations.push(element);
      elementIds.push(element.id);
    }

    // Calculate combined bounding box for the state
    const stateBbox = calculateCombinedBbox(pageClickables);

    // Create state annotation
    const stateAnnotation: StateAnnotation = {
      id: stateId,
      name: stateName,
      bbox: stateBbox,
      state_type: "page",
      element_ids: elementIds,
      screenshot_id: screenshotId,
      source_url: url,
      detection_method: "playwright",
      confidence: calculateAverageConfidence(pageClickables),
    };

    // Create extraction annotation for this page
    const annotation: ExtractionAnnotation = {
      id: `playwright-annotation-${stateIndex}`,
      session_id: results.job_id || `session-${Date.now()}`,
      screenshot_id: screenshotId,
      source_url: url,
      viewport_width: 1920, // Default viewport
      viewport_height: 1080,
      elements: elementAnnotations,
      states: [stateAnnotation],
    };

    annotations.push(annotation);

    // Create StateMachineState
    const state: StateMachineState = {
      id: stateId,
      name: stateName,
      description: `Extracted from ${url}`,
      stateImages: stateImages as StateMachineStateImage[],
      regions: [],
      locations: [],
      strings: [],
      position: { x: stateBbox.x, y: stateBbox.y },
      initial: stateIndex === 0,
      isFinal: false,
    };

    states.push(state);
    stateIndex++;
  }

  return {
    states,
    annotations,
    screenshotMap,
    thumbnailMap,
  };
}

/**
 * Group clickables by their source URL.
 */
function groupClickablesByPage(
  clickables: ExtendedPlaywrightClickable[],
  pagesVisited: string[]
): Map<string, ExtendedPlaywrightClickable[]> {
  const groups = new Map<string, ExtendedPlaywrightClickable[]>();

  // Initialize groups for all visited pages
  for (const url of pagesVisited) {
    groups.set(url, []);
  }

  // Group clickables by their source_url if available, otherwise use first page
  const defaultUrl = pagesVisited[0] || "unknown";

  for (const clickable of clickables) {
    const url = clickable.source_url || defaultUrl;
    const existing = groups.get(url) || groups.get(defaultUrl) || [];
    existing.push(clickable);
    if (!groups.has(url)) {
      groups.set(defaultUrl, existing);
    } else {
      groups.set(url, existing);
    }
  }

  return groups;
}

/**
 * Convert a clickable to an ElementAnnotation.
 */
function clickableToElementAnnotation(
  clickable: ExtendedPlaywrightClickable,
  elementId: string
): ElementAnnotation {
  return {
    id: elementId,
    name: clickable.text || clickable.aria_label || clickable.tag_name,
    element_type: clickable.tag_name,
    bbox: clickable.bounding_box,
    text: clickable.text,
    selector: clickable.selector,
    confidence: clickable.verification_confidence,
  };
}

/**
 * Convert a clickable to a StateMachineStateImage.
 */
function clickableToStateImage(
  clickable: ExtendedPlaywrightClickable,
  screenshotId: string,
  elementId: string
): StateMachineStateImage & { base64?: string } {
  const name = clickable.text || clickable.aria_label || `${clickable.tag_name} element`;

  return {
    id: `stateimage-${elementId}`,
    name,
    patterns: [
      {
        id: `pattern-${elementId}`,
        name,
        searchRegions: [clickable.bounding_box],
        fixed: false,
      },
    ],
    shared: false,
    searchRegions: [clickable.bounding_box],
    bbox: clickable.bounding_box,
    screenshotId,
    extractionCategory: clickable.verified
      ? `verified:${clickable.tag_name}`
      : `unverified:${clickable.tag_name}`,
    base64: clickable.screenshot || undefined,
  };
}

/**
 * Calculate combined bounding box from clickables.
 */
function calculateCombinedBbox(clickables: ExtendedPlaywrightClickable[]): BoundingBox {
  const boxes = clickables
    .map((c) => c.bounding_box)
    .filter((b): b is BoundingBox => b != null);

  if (boxes.length === 0) {
    return { x: 0, y: 0, width: 200, height: 80 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate average confidence from clickables.
 */
function calculateAverageConfidence(
  clickables: ExtendedPlaywrightClickable[]
): number {
  if (clickables.length === 0) return 0;

  const withConfidence = clickables.filter((c) => c.verification_confidence != null);
  if (withConfidence.length === 0) return 0;

  const total = withConfidence.reduce(
    (sum, c) => sum + (c.verification_confidence || 0),
    0
  );
  return total / withConfidence.length;
}

/**
 * Filter clickables to only include verified elements.
 */
export function filterVerifiedClickables(
  clickables: PlaywrightClickable[]
): PlaywrightClickable[] {
  return clickables.filter((c) => c.verified);
}

/**
 * Filter clickables by minimum confidence threshold.
 */
export function filterByConfidence(
  clickables: PlaywrightClickable[],
  minConfidence: number
): PlaywrightClickable[] {
  return clickables.filter((c) => (c.verification_confidence || 0) >= minConfidence);
}
