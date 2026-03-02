"use client";

import type { UnifiedExecutionStep } from "@/types/tree-events";
import { resolveName } from "../utils";

interface QuickPreviewProps {
  step: UnifiedExecutionStep;
  nameMap?: Map<string, string>;
}

/**
 * Renders a short inline preview of the step's most relevant data.
 */
export function QuickPreview({ step, nameMap }: QuickPreviewProps) {
  // State context preview
  if (
    step.stateContext?.activeAfter &&
    step.stateContext.activeAfter.length > 0
  ) {
    return (
      <span>
        States:{" "}
        {step.stateContext.activeAfter
          .map((s) => resolveName(s, nameMap))
          .join(", ")}
      </span>
    );
  }

  // Input data preview
  if (step.inputData?.text) {
    return <span>Text: &quot;{step.inputData.text}&quot;</span>;
  }

  // Match location preview
  if (step.matchLocation) {
    return (
      <span>
        Match: ({step.matchLocation.x}, {step.matchLocation.y})
        {step.matchLocation.confidence &&
          ` @ ${(step.matchLocation.confidence * 100).toFixed(0)}%`}
      </span>
    );
  }

  return null;
}
