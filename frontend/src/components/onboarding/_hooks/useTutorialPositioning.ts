import { useCallback, useRef, useState } from "react";
import type {
  SpotlightPosition,
  TooltipPosition,
  TutorialStep,
} from "../types";
import { SPOTLIGHT_PADDING, TOOLTIP_OFFSET } from "../types";

export function useTutorialPositioning(currentStep: TutorialStep | undefined) {
  const [spotlightPos, setSpotlightPos] = useState<SpotlightPosition | null>(
    null
  );
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const calculateSpotlightPosition = useCallback(
    (element: Element): SpotlightPosition => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top - SPOTLIGHT_PADDING,
        left: rect.left - SPOTLIGHT_PADDING,
        width: rect.width + SPOTLIGHT_PADDING * 2,
        height: rect.height + SPOTLIGHT_PADDING * 2,
      };
    },
    []
  );

  const calculateTooltipPosition = useCallback(
    (
      targetRect: DOMRect,
      tooltipWidth: number,
      tooltipHeight: number,
      preferredPlacement: TutorialStep["placement"] = "auto"
    ): TooltipPosition => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      const spaceTop = targetRect.top;
      const spaceBottom = viewportHeight - targetRect.bottom;
      const spaceLeft = targetRect.left;
      const spaceRight = viewportWidth - targetRect.right;

      let placement: "top" | "bottom" | "left" | "right" = "bottom";
      let top = 0;
      let left = 0;

      if (preferredPlacement === "auto") {
        if (spaceBottom >= tooltipHeight + TOOLTIP_OFFSET) {
          placement = "bottom";
        } else if (spaceTop >= tooltipHeight + TOOLTIP_OFFSET) {
          placement = "top";
        } else if (spaceRight >= tooltipWidth + TOOLTIP_OFFSET) {
          placement = "right";
        } else if (spaceLeft >= tooltipWidth + TOOLTIP_OFFSET) {
          placement = "left";
        } else {
          placement = "bottom";
        }
      } else {
        placement = preferredPlacement;
      }

      switch (placement) {
        case "top":
          top = targetRect.top + scrollY - tooltipHeight - TOOLTIP_OFFSET;
          left =
            targetRect.left + scrollX + targetRect.width / 2 - tooltipWidth / 2;
          break;

        case "bottom":
          top = targetRect.bottom + scrollY + TOOLTIP_OFFSET;
          left =
            targetRect.left + scrollX + targetRect.width / 2 - tooltipWidth / 2;
          break;

        case "left":
          top =
            targetRect.top +
            scrollY +
            targetRect.height / 2 -
            tooltipHeight / 2;
          left = targetRect.left + scrollX - tooltipWidth - TOOLTIP_OFFSET;
          break;

        case "right":
          top =
            targetRect.top +
            scrollY +
            targetRect.height / 2 -
            tooltipHeight / 2;
          left = targetRect.right + scrollX + TOOLTIP_OFFSET;
          break;
      }

      const margin = 16;
      left = Math.max(
        margin,
        Math.min(left, viewportWidth - tooltipWidth - margin)
      );
      top = Math.max(
        margin + scrollY,
        Math.min(top, viewportHeight + scrollY - tooltipHeight - margin)
      );

      return { top, left, placement };
    },
    []
  );

  const updatePositions = useCallback(() => {
    if (!currentStep) return;

    const targetElement = document.querySelector(currentStep.target);
    if (!targetElement) {
      console.warn(`Tutorial target not found: ${currentStep.target}`);
      return;
    }

    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });

    setTimeout(() => {
      const targetRect = targetElement.getBoundingClientRect();

      setSpotlightPos(calculateSpotlightPosition(targetElement));

      const tooltipWidth = tooltipRef.current?.offsetWidth || 320;
      const tooltipHeight = tooltipRef.current?.offsetHeight || 200;
      setTooltipPos(
        calculateTooltipPosition(
          targetRect,
          tooltipWidth,
          tooltipHeight,
          currentStep.placement
        )
      );
    }, 100);
  }, [currentStep, calculateSpotlightPosition, calculateTooltipPosition]);

  return {
    spotlightPos,
    tooltipPos,
    tooltipRef,
    updatePositions,
  };
}
