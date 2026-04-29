import { useCallback } from "react";
import { toast } from "sonner";
import {
  useExtractionAnnotationStore,
  type AnnotatedElement,
} from "@/stores/extraction-annotation-store";
import type { ExtractionState } from "./useExtractionState";

interface UseVisionExtractionArgs {
  state: ExtractionState;
  visionConfig: {
    source: string;
    screenshotPath?: string;
    windowTitle?: string;
    monitorIndex?: number;
    edgeDetection: {
      enabled: boolean;
      cannyLow: number;
      cannyHigh: number;
      minContourArea: number;
      maxContourArea: number;
    };
    sam3: {
      enabled: boolean;
      modelType: string;
      pointsPerSide: number;
      predIouThreshold: number;
      stabilityScoreThreshold: number;
    };
    ocr: {
      enabled: boolean;
      engine: string;
      minConfidence: number;
    };
    fusion: {
      iouThreshold: number;
      maxCandidates: number;
    };
  };
  getRunnerUrl: (runnerId: string | null) => string | null;
}

export function useVisionExtraction({
  state,
  visionConfig,
  getRunnerUrl,
}: UseVisionExtractionArgs) {
  const annotationStore = useExtractionAnnotationStore();

  const startVisionExtraction = useCallback(async () => {
    const runnerUrl = getRunnerUrl(state.selectedRunnerId);
    if (!runnerUrl) {
      toast.error("Please select a connected runner");
      return;
    }

    state.setVisionExtractionProgress({
      status: "running",
      elementsDetected: 0,
    });

    // Build screenshot source based on config
    let screenshotSource = "";
    if (visionConfig.source === "upload" && visionConfig.screenshotPath) {
      screenshotSource = visionConfig.screenshotPath;
    } else if (visionConfig.source === "window" && visionConfig.windowTitle) {
      screenshotSource = `window:${visionConfig.windowTitle}`;
    } else if (visionConfig.source === "monitor") {
      screenshotSource = `monitor:${visionConfig.monitorIndex ?? 0}`;
    }

    // Build techniques array
    const techniques: string[] = [];
    if (visionConfig.edgeDetection.enabled) techniques.push("edge");
    if (visionConfig.sam3.enabled) techniques.push("sam3");
    if (visionConfig.ocr.enabled) techniques.push("ocr");

    const requestBody = {
      screenshot: screenshotSource,
      techniques: techniques.length > 0 ? techniques : undefined,
      canny_low: visionConfig.edgeDetection.cannyLow,
      canny_high: visionConfig.edgeDetection.cannyHigh,
      min_contour_area: visionConfig.edgeDetection.minContourArea,
      max_contour_area: visionConfig.edgeDetection.maxContourArea,
      sam_model_type: visionConfig.sam3.modelType,
      points_per_side: visionConfig.sam3.pointsPerSide,
      pred_iou_threshold: visionConfig.sam3.predIouThreshold,
      stability_score_threshold: visionConfig.sam3.stabilityScoreThreshold,
      ocr_engine: visionConfig.ocr.engine,
      ocr_min_confidence: visionConfig.ocr.minConfidence,
      iou_threshold: visionConfig.fusion.iouThreshold,
      max_candidates: visionConfig.fusion.maxCandidates,
    };

    const response = await fetch(`${runnerUrl}/extraction/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.success && data.data) {
      const visionSessionId = `vision_${Date.now()}`;

      annotationStore.setSession(visionSessionId, undefined, screenshotSource);

      const elements: AnnotatedElement[] = (data.data.elements || []).map(
        (
          el: {
            bbox: { x: number; y: number; width: number; height: number };
            label?: string;
            element_type?: string;
            text?: string;
            confidence?: number;
            detection_technique?: string;
          },
          idx: number
        ) => ({
          id: `vision_${Date.now()}_${idx}`,
          bbox: el.bbox,
          label: el.label || `Element ${idx + 1}`,
          elementType: el.element_type || "other",
          text: el.text,
          confidence: el.confidence || 0.5,
          isGroundTruth: false,
          isAutoDetected: true,
          detectionTechnique: el.detection_technique,
        })
      );

      annotationStore.setElements(elements);

      if (data.data.screenshot_url) {
        annotationStore.setScreenshot(
          data.data.screenshot_url,
          data.data.screenshot_width || 1920,
          data.data.screenshot_height || 1080
        );
        state.setVisionExtractionProgress((prev) => ({
          ...prev,
          screenshotUrl: data.data.screenshot_url,
        }));
      }

      state.setVisionExtractionProgress({
        status: "completed",
        elementsDetected: elements.length,
        screenshotUrl: data.data.screenshot_url,
      });
      toast.success(
        `Vision extraction completed: ${elements.length} elements detected`
      );
      state.setMainTab("results");
    } else {
      throw new Error(data.error || "Vision extraction failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [getRunnerUrl, state.selectedRunnerId, visionConfig, annotationStore]);

  return {
    startVisionExtraction,
    annotationStore,
  };
}
