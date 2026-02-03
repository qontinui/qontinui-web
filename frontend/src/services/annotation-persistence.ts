/**
 * Annotation Persistence Service
 *
 * Provides methods to save and load annotations to/from the backend.
 * Maps between frontend AnnotatedElement format and backend ElementAnnotation format.
 */

import type { AnnotatedElement } from "@/stores/extraction-annotation-store";
import type { ElementAnnotation } from "@/types/extraction";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Request payload for saving annotations
 */
interface AnnotationUpdateRequest {
  screenshot_id: string;
  source_url?: string;
  viewport_width: number;
  viewport_height: number;
  elements: ElementAnnotation[];
  states: never[]; // We don't edit states in the annotation editor
  vision_results?: null;
}

/**
 * Response from backend annotation endpoint
 */
interface AnnotationResponse {
  id: string;
  session_id: string;
  screenshot_id: string;
  source_url: string;
  viewport_width: number;
  viewport_height: number;
  elements: ElementAnnotation[];
  states: unknown[];
  vision_results: unknown | null;
  created_at: string;
  updated_at: string;
}

/**
 * Extended element data stored in backend (includes our custom fields)
 */
interface ExtendedElementAnnotation extends ElementAnnotation {
  label?: string;
  description?: string;
  reasoning?: string;
  is_ground_truth?: boolean;
  is_auto_detected?: boolean;
  detection_technique?: string;
  is_clickable?: boolean;
}

/**
 * Convert frontend AnnotatedElement to backend ElementAnnotation format
 */
function toBackendFormat(element: AnnotatedElement): ExtendedElementAnnotation {
  return {
    id: element.id,
    name: element.label,
    element_type: element.elementType,
    bbox: element.bbox,
    text: element.text || null,
    confidence: element.confidence,
    // Extended fields stored in the JSON
    label: element.label,
    description: element.description,
    reasoning: element.reasoning,
    is_ground_truth: element.isGroundTruth,
    is_auto_detected: element.isAutoDetected,
    detection_technique: element.detectionTechnique,
    is_clickable: element.isClickable,
  };
}

/**
 * Convert backend ElementAnnotation to frontend AnnotatedElement format
 */
function toFrontendFormat(
  element: ExtendedElementAnnotation
): AnnotatedElement {
  return {
    id: element.id,
    bbox: element.bbox,
    label: element.label || element.name || "Element",
    elementType: element.element_type,
    text: element.text || undefined,
    description: element.description,
    reasoning: element.reasoning,
    confidence: element.confidence || 0.5,
    isGroundTruth: element.is_ground_truth || false,
    isAutoDetected: element.is_auto_detected ?? true,
    detectionTechnique: element.detection_technique,
    isClickable: element.is_clickable,
  };
}

/**
 * Get auth token from localStorage (same pattern as other services)
 */
async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

/**
 * Save annotations to the backend
 */
export async function saveAnnotations(
  extractionId: string,
  screenshotId: string,
  elements: AnnotatedElement[],
  options: {
    sourceUrl?: string;
    viewportWidth?: number;
    viewportHeight?: number;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const token = await getAuthToken();
    if (!token) {
      return { success: false, error: "Not authenticated" };
    }

    const payload: AnnotationUpdateRequest = {
      screenshot_id: screenshotId,
      source_url: options.sourceUrl || "",
      viewport_width: options.viewportWidth || 1920,
      viewport_height: options.viewportHeight || 1080,
      elements: elements.map(toBackendFormat),
      states: [],
    };

    const response = await fetch(
      `${API_BASE}/api/v1/extractions/${extractionId}/annotations`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.detail || `HTTP ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Load annotations from the backend
 */
export async function loadAnnotations(extractionId: string): Promise<{
  success: boolean;
  annotations?: Array<{
    screenshotId: string;
    elements: AnnotatedElement[];
    sourceUrl: string;
    viewportWidth: number;
    viewportHeight: number;
  }>;
  error?: string;
}> {
  try {
    const token = await getAuthToken();
    if (!token) {
      return { success: false, error: "Not authenticated" };
    }

    const response = await fetch(
      `${API_BASE}/api/v1/extractions/${extractionId}/annotations`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.detail || `HTTP ${response.status}`,
      };
    }

    const data: AnnotationResponse[] = await response.json();

    const annotations = data.map((ann) => ({
      screenshotId: ann.screenshot_id,
      elements: (ann.elements as ExtendedElementAnnotation[]).map(
        toFrontendFormat
      ),
      sourceUrl: ann.source_url,
      viewportWidth: ann.viewport_width,
      viewportHeight: ann.viewport_height,
    }));

    return { success: true, annotations };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Generate a screenshot ID from extraction and page info
 */
export function generateScreenshotId(
  extractionId: string,
  pageIndex: number = 0
): string {
  return `${extractionId}-page-${pageIndex}`;
}
