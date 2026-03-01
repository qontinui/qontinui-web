import type { VisionExtractionResponse } from "@/services/vision-extraction-service";
import type { ExtractionAnnotation } from "@/services/extraction-service";
import type { ExtractionSessionDetail } from "@/services/extraction-service";
import type {
  StateMachineState,
  StateMachineStateImage,
  ElementAnnotation,
} from "@/types/extraction";

/**
 * Aggregate vision results from all annotations that have vision_results.
 * Returns null if no annotations have vision results.
 */
export function aggregateVisionResults(
  annotations: ExtractionAnnotation[]
): VisionExtractionResponse | null {
  if (!annotations || annotations.length === 0) return null;

  // Find first annotation with vision results (typically all will have them or none)
  const annotationWithVision = annotations.find((a) => a.vision_results);
  if (!annotationWithVision?.vision_results) return null;

  // Aggregate all vision results from all annotations
  const aggregated: VisionExtractionResponse = {
    screenshot_id: annotationWithVision.screenshot_id,
    image_width: annotationWithVision.viewport_width,
    image_height: annotationWithVision.viewport_height,
    edge_results: [],
    sam3_results: [],
    ocr_results: [],
    merged_candidates: [],
    edge_overlay: null,
    sam3_overlay: null,
    ocr_overlay: null,
    techniques_run: [],
    processing_time_ms: 0,
  };

  for (const annotation of annotations) {
    if (!annotation.vision_results) continue;
    const vr = annotation.vision_results;

    // Add results (with prefixed IDs to avoid collisions)
    // Cast to the expected types since vision_results comes from JSON storage
    if (vr.edge_results) {
      for (const r of vr.edge_results) {
        aggregated.edge_results.push({
          ...r,
          id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
        } as (typeof aggregated.edge_results)[number]);
      }
    }
    if (vr.sam3_results) {
      for (const r of vr.sam3_results) {
        aggregated.sam3_results.push({
          ...r,
          id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
        } as (typeof aggregated.sam3_results)[number]);
      }
    }
    if (vr.ocr_results) {
      for (const r of vr.ocr_results) {
        aggregated.ocr_results.push({
          ...r,
          id: `${annotation.screenshot_id}-${r.id || Math.random().toString(36).slice(2)}`,
        } as (typeof aggregated.ocr_results)[number]);
      }
    }
    if (vr.merged_candidates) {
      aggregated.merged_candidates.push(
        ...(vr.merged_candidates as unknown as typeof aggregated.merged_candidates)
      );
    }

    // Use first available overlay
    if (!aggregated.edge_overlay && vr.edge_overlay) {
      aggregated.edge_overlay = vr.edge_overlay;
    }
    if (!aggregated.sam3_overlay && vr.sam3_overlay) {
      aggregated.sam3_overlay = vr.sam3_overlay;
    }
    if (!aggregated.ocr_overlay && vr.ocr_overlay) {
      aggregated.ocr_overlay = vr.ocr_overlay;
    }

    // Aggregate techniques and time
    if (vr.techniques_run) {
      for (const t of vr.techniques_run) {
        if (!aggregated.techniques_run.includes(t)) {
          aggregated.techniques_run.push(t);
        }
      }
    }
    if (vr.duration_ms) {
      aggregated.processing_time_ms += vr.duration_ms;
    }
  }

  return aggregated;
}

/**
 * Build StateMachineState[] from extraction detail and annotations.
 * First tries pre-built state machine from runner, then falls back to annotation states.
 */
export function buildStateMachineStates(
  extractionDetail: ExtractionSessionDetail | null,
  annotations: ExtractionAnnotation[]
): StateMachineState[] {
  // First try: use pre-built state machine from runner
  if (extractionDetail?.state_machine?.states?.length) {
    // Process pre-built states to ensure unique stateImage IDs
    // The runner may create stateImages with duplicate IDs when the same element
    // appears on multiple screenshots. We need to make IDs unique.
    let globalImageIndex = 0;

    const processedStates = extractionDetail.state_machine.states.map(
      (state) => ({
        ...state,
        stateImages: state.stateImages.map((img) => {
          globalImageIndex++;
          // Create a truly unique ID by combining state id, image index, and global counter
          const uniqueId = `${state.id}-img-${globalImageIndex}`;
          return {
            ...img,
            id: uniqueId,
            patterns:
              img.patterns?.map((p, pIdx) => ({
                ...p,
                id: `${uniqueId}-pattern-${pIdx}`,
              })) || [],
          };
        }),
      })
    );

    return processedStates;
  }

  // Fallback: convert annotation states to StateMachineState format
  // Group states by NAME (not ID) to deduplicate across pages
  // Use elements within each state as separate stateImages
  if (annotations.length > 0) {
    // Track state occurrences grouped by name
    interface StateOccurrence {
      stateId: string;
      stateName: string;
      stateBbox: { x: number; y: number; width: number; height: number };
      elements: ElementAnnotation[];
      screenshotId: string;
      sourceUrl: string;
    }

    const statesByName = new Map<string, StateOccurrence[]>();

    for (const annotation of annotations) {
      // Build element lookup for this annotation
      const elementMap = new Map<string, ElementAnnotation>();
      for (const element of annotation.elements || []) {
        elementMap.set(element.id, element);
      }

      for (const state of annotation.states || []) {
        const stateName = state.name || "Unknown State";

        // Get elements for this state
        const stateElements: ElementAnnotation[] = [];
        for (const elementId of state.element_ids || []) {
          const element = elementMap.get(elementId);
          if (element) {
            stateElements.push(element);
          }
        }

        // Add to grouped states
        if (!statesByName.has(stateName)) {
          statesByName.set(stateName, []);
        }
        statesByName.get(stateName)!.push({
          stateId: state.id,
          stateName,
          stateBbox: state.bbox || { x: 0, y: 0, width: 200, height: 80 },
          elements: stateElements,
          screenshotId: annotation.screenshot_id,
          sourceUrl: annotation.source_url,
        });
      }
    }

    // Convert grouped states to StateMachineState format
    const result: StateMachineState[] = [];
    let stateIndex = 0;

    for (const [stateName, occurrences] of statesByName) {
      // Use the first occurrence as the representative state
      const firstOccurrence = occurrences[0];
      if (!firstOccurrence) continue;

      const stateBbox = firstOccurrence.stateBbox;

      // Collect all unique elements across all occurrences as stateImages
      const stateImages: StateMachineStateImage[] = [];
      const seenElementNames = new Set<string>();

      for (const occurrence of occurrences) {
        if (occurrence.elements.length > 0) {
          // Use elements as individual images within the state
          for (const element of occurrence.elements) {
            const elementName =
              element.name || element.text || element.element_type || "Element";

            // Skip duplicates by name within the same screenshot
            // (same element on different screenshots needs separate entries with correct bboxes)
            const dedupeKey = `${occurrence.screenshotId}-${elementName}`;
            if (seenElementNames.has(dedupeKey)) continue;
            seenElementNames.add(dedupeKey);

            const elementBbox = element.bbox || stateBbox;
            // Use screenshotId in IDs to ensure uniqueness across screenshots
            const uniqueId = `${occurrence.screenshotId}-${element.id}`;
            stateImages.push({
              id: `stateimage-${uniqueId}`,
              name: elementName,
              patterns: [
                {
                  id: `pattern-${uniqueId}`,
                  name: elementName,
                  searchRegions: [elementBbox],
                  fixed: false,
                },
              ],
              shared: false,
              searchRegions: [elementBbox],
              screenshotId: occurrence.screenshotId,
              sourceUrl: occurrence.sourceUrl,
            });
          }
        }
      }

      // If no elements found, use the state bbox as the only image
      if (stateImages.length === 0) {
        stateImages.push({
          id: `stateimage-${firstOccurrence.stateId}`,
          name: stateName,
          patterns: [
            {
              id: `pattern-${firstOccurrence.stateId}`,
              name: stateName,
              searchRegions: [stateBbox],
              fixed: false,
            },
          ],
          shared: false,
          searchRegions: [stateBbox],
          screenshotId: firstOccurrence.screenshotId,
          sourceUrl: firstOccurrence.sourceUrl,
        });
      }

      result.push({
        id: firstOccurrence.stateId,
        name: stateName,
        description: `Extracted from ${firstOccurrence.sourceUrl || "page"}`,
        stateImages,
        regions: [],
        locations: [],
        strings: [],
        position: { x: stateBbox.x, y: stateBbox.y },
        initial: stateIndex === 0,
        isFinal: false,
      });

      stateIndex++;
    }

    return result;
  }

  return [];
}
