import { useCallback, useEffect, useRef, useState } from "react";
import { TooltipPlacement } from "../tooltip-types";

interface UseTooltipPositionOptions {
  placement: TooltipPlacement;
  offset: number;
  delay: number;
  disabled: boolean;
}

export function useTooltipPosition({
  placement,
  offset,
  delay,
  disabled,
}: UseTooltipPositionOptions) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const tooltipRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const calculatePosition = useCallback(() => {
    if (!targetRef.current || !tooltipRef.current) return;

    const targetRect = targetRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = 0;
    let y = 0;
    let finalPlacement = placement === "auto" ? "top" : placement;

    switch (finalPlacement) {
      case "top":
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - offset;
        break;
      case "bottom":
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.bottom + offset;
        break;
      case "left":
        x = targetRect.left - tooltipRect.width - offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
      case "right":
        x = targetRect.right + offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
        break;
    }

    if (placement === "auto") {
      if (targetRect.top - tooltipRect.height - offset >= 0) {
        finalPlacement = "top";
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.top - tooltipRect.height - offset;
      } else if (
        targetRect.bottom + tooltipRect.height + offset <=
        viewportHeight
      ) {
        finalPlacement = "bottom";
        x = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
        y = targetRect.bottom + offset;
      } else if (
        targetRect.right + tooltipRect.width + offset <=
        viewportWidth
      ) {
        finalPlacement = "right";
        x = targetRect.right + offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
      } else {
        finalPlacement = "left";
        x = targetRect.left - tooltipRect.width - offset;
        y = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
      }
    }

    if (x < 10) x = 10;
    if (x + tooltipRect.width > viewportWidth - 10) {
      x = viewportWidth - tooltipRect.width - 10;
    }

    if (y < 10) y = 10;
    if (y + tooltipRect.height > viewportHeight - 10) {
      y = viewportHeight - tooltipRect.height - 10;
    }

    setPosition({ x, y });
  }, [placement, offset]);

  const showTooltip = useCallback(() => {
    if (disabled) return;

    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      requestAnimationFrame(calculatePosition);
    }, delay);
  }, [disabled, delay, calculatePosition]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isVisible) {
      calculatePosition();
    }
  }, [isVisible, calculatePosition]);

  return {
    isVisible,
    position,
    tooltipRef,
    targetRef,
    showTooltip,
    hideTooltip,
  };
}
