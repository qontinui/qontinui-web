"use client";

/**
 * SpotlightOverlay Component
 *
 * Creates a dark overlay that dims the entire page with a spotlight effect
 * highlighting the target element. Blocks interactions outside the spotlight
 * when allowInteraction is false.
 */

import React, { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface SpotlightOverlayProps {
  /** Target element to spotlight (CSS selector) */
  targetSelector: string | null;
  /** Whether to allow interaction with the highlighted element */
  allowInteraction?: boolean;
  /** Padding around the spotlight (pixels) */
  padding?: number;
  /** Border radius of the spotlight */
  borderRadius?: number;
  /** Overlay opacity (0-1) */
  overlayOpacity?: number;
  /** Whether the overlay is visible */
  isVisible?: boolean;
  /** Callback when overlay is clicked */
  onClick?: () => void;
  /** Custom class name */
  className?: string;
}

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const SpotlightOverlay: React.FC<SpotlightOverlayProps> = ({
  targetSelector,
  allowInteraction = false,
  padding = 8,
  borderRadius = 8,
  overlayOpacity = 0.75,
  isVisible = true,
  onClick,
  className = "",
}) => {
  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(
    null
  );

  const updateSpotlight = useCallback(() => {
    if (!targetSelector) {
      setSpotlightRect(null);
      return;
    }

    const element = document.querySelector(targetSelector);
    if (!element) {
      setSpotlightRect(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    setSpotlightRect({
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });
  }, [targetSelector, padding]);

  // Update spotlight on mount and when dependencies change
  useEffect(() => {
    updateSpotlight();
  }, [updateSpotlight]);

  // Update spotlight on scroll and resize
  useEffect(() => {
    if (!targetSelector) return;

    const handleUpdate = () => {
      updateSpotlight();
    };

    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);

    // Use ResizeObserver to track target element size changes
    const element = document.querySelector(targetSelector);
    let resizeObserver: ResizeObserver | null = null;

    if (element) {
      resizeObserver = new ResizeObserver(handleUpdate);
      resizeObserver.observe(element);
    }

    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [targetSelector, updateSpotlight]);

  // Set z-index of target element when interaction is allowed
  useEffect(() => {
    if (!targetSelector || !allowInteraction) return;

    const element = document.querySelector(targetSelector) as HTMLElement;
    if (!element) return;

    const originalZIndex = element.style.zIndex;
    const originalPosition = element.style.position;

    element.style.zIndex = "10001";
    if (originalPosition === "" || originalPosition === "static") {
      element.style.position = "relative";
    }

    return () => {
      element.style.zIndex = originalZIndex;
      element.style.position = originalPosition;
    };
  }, [targetSelector, allowInteraction]);

  if (!isVisible) {
    return null;
  }

  // Create SVG mask for spotlight effect
  const maskId = `spotlight-mask-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className={`fixed inset-0 z-[10000] ${className}`}
        style={{ pointerEvents: allowInteraction ? "none" : "auto" }}
        onClick={onClick}
        role="presentation"
        aria-hidden="true"
      >
        <svg
          width="100%"
          height="100%"
          className="absolute inset-0"
          style={{ pointerEvents: "none" }}
        >
          <defs>
            <mask id={maskId}>
              {/* White background - everything is covered */}
              <rect x="0" y="0" width="100%" height="100%" fill="white" />

              {/* Black cutout - this area is transparent (spotlight) */}
              {spotlightRect && (
                <motion.rect
                  initial={{
                    x: spotlightRect.x,
                    y: spotlightRect.y,
                    width: spotlightRect.width,
                    height: spotlightRect.height,
                  }}
                  animate={{
                    x: spotlightRect.x,
                    y: spotlightRect.y,
                    width: spotlightRect.width,
                    height: spotlightRect.height,
                  }}
                  transition={{ duration: 0.3, ease: "easeInOut" }}
                  rx={borderRadius}
                  ry={borderRadius}
                  fill="black"
                />
              )}
            </mask>
          </defs>

          {/* Dark overlay with mask applied */}
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="black"
            opacity={overlayOpacity}
            mask={`url(#${maskId})`}
          />

          {/* Highlight border around spotlight */}
          {spotlightRect && (
            <motion.rect
              initial={{
                x: spotlightRect.x,
                y: spotlightRect.y,
                width: spotlightRect.width,
                height: spotlightRect.height,
              }}
              animate={{
                x: spotlightRect.x,
                y: spotlightRect.y,
                width: spotlightRect.width,
                height: spotlightRect.height,
              }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              rx={borderRadius}
              ry={borderRadius}
              fill="none"
              stroke="#3B82F6"
              strokeWidth="2"
              className="drop-shadow-lg"
            />
          )}
        </svg>

        {/* Pulse animation around spotlight for extra attention */}
        {spotlightRect && (
          <motion.div
            className="absolute border-2 border-blue-400 rounded-lg pointer-events-none"
            style={{
              left: spotlightRect.x,
              top: spotlightRect.y,
              width: spotlightRect.width,
              height: spotlightRect.height,
              borderRadius: borderRadius,
            }}
            animate={{
              opacity: [0.5, 0, 0.5],
              scale: [1, 1.05, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
};

export default SpotlightOverlay;
