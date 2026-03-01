import { useState, useRef } from "react";
import { toast } from "sonner";
import type {
  SemanticObject,
  SemanticScene,
  ProcessingOptions,
  SemanticProcessResponse,
} from "@/types/semantic-analysis";
import type {
  ProcessingOptionsState,
  ImageAnalysisState,
} from "../semantic-analysis-types";

export function useImageAnalysis(
  processingOptions: ProcessingOptionsState
): ImageAnalysisState {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [scene, setScene] = useState<SemanticScene | null>(null);
  const [selectedObject, setSelectedObject] = useState<SemanticObject | null>(
    null
  );
  const [hoveredObject, setHoveredObject] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setSelectedImage(result);
      setScene(null);
      setSelectedObject(null);
    };
    reader.readAsDataURL(file);
  };

  const processImage = async () => {
    if (!selectedImage) {
      toast.error("Please upload an image first");
      return;
    }

    setProcessing(true);
    try {
      const options: ProcessingOptions = {
        enable_ocr: processingOptions.enableOCR,
        min_confidence: processingOptions.confidence,
        description_model: processingOptions.descriptionModel,
      };

      const requestBody: {
        image: string;
        strategy: string;
        options: unknown;
        text_prompt?: string;
      } = {
        image: selectedImage,
        strategy: processingOptions.strategy,
        options,
      };

      // Only include text_prompt if it's not empty and strategy is sam3
      if (
        processingOptions.textPrompt.trim() &&
        processingOptions.strategy === "sam3"
      ) {
        requestBody.text_prompt = processingOptions.textPrompt.trim();
      }

      const response = await fetch(
        "http://localhost:8000/api/semantic/process",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const data: SemanticProcessResponse = await response.json();
      setScene(data.scene);
      toast.success(
        `Detected ${data.scene.object_count} objects in ${data.processing_time_ms.toFixed(0)}ms`
      );
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("Failed to process image");
    } finally {
      setProcessing(false);
    }
  };

  return {
    selectedImage,
    processing,
    scene,
    selectedObject,
    hoveredObject,
    setSelectedImage,
    setScene,
    setSelectedObject,
    setHoveredObject,
    handleImageUpload,
    processImage,
    fileInputRef,
  };
}
