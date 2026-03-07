import { useMemo } from "react";
import type { ImageWithMetadata } from "../types";

interface WorkflowLike {
  id: string;
  name: string;
  actions: Array<{ config: unknown }>;
}

interface StateLike {
  id: string;
  name: string;
  stateImages: Array<{
    patterns: Array<{ imageId?: string }>;
  }>;
}

export interface ImageUsageDetail {
  workflowId: string;
  workflowName: string;
  stateId?: string;
  stateName?: string;
}

export function useImageUsageDetails(
  selectedImage: ImageWithMetadata | null,
  workflows: WorkflowLike[],
  states: StateLike[]
): ImageUsageDetail[] {
  return useMemo(() => {
    if (!selectedImage) return [];

    const details: ImageUsageDetail[] = [];

    workflows.forEach((workflow) => {
      const usesImage = workflow.actions.some((action) => {
        const config = action.config as { imageId?: string };
        return config.imageId === selectedImage.id;
      });
      if (usesImage) {
        details.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
        });
      }
    });

    states.forEach((state) => {
      const usesImage = state.stateImages.some((stateImage) =>
        stateImage.patterns.some(
          (pattern) => pattern.imageId === selectedImage.id
        )
      );
      if (usesImage) {
        details.push({
          workflowId: "",
          workflowName: "",
          stateId: state.id,
          stateName: state.name,
        });
      }
    });

    return details;
  }, [selectedImage, workflows, states]);
}
