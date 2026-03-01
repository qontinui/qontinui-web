import { useState } from "react";
import type {
  DetectionStrategy,
  DescriptionModel,
  ProcessingOptionsState,
} from "../semantic-analysis-types";

export function useProcessingOptions(): ProcessingOptionsState {
  const [confidence, setConfidence] = useState(0.7);
  const [enableOCR, setEnableOCR] = useState(true);
  const [descriptionModel, setDescriptionModel] =
    useState<DescriptionModel>("clip");
  const [strategy, setStrategy] = useState<DetectionStrategy>("hybrid");
  const [textPrompt, setTextPrompt] = useState("");

  return {
    confidence,
    setConfidence,
    enableOCR,
    setEnableOCR,
    descriptionModel,
    setDescriptionModel,
    strategy,
    setStrategy,
    textPrompt,
    setTextPrompt,
  };
}
