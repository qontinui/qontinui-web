/**
 * Screenshot Canvas Component
 *
 * Base canvas component for displaying screenshots with overlays.
 * Used by all vision extraction debug views.
 */

"use client";

import { useRef, useState, useEffect } from "react";
import type { BoundingBox } from "@/types/vision-extraction";

interface ScreenshotCanvasProps {
  /** Base64-encoded image or image URL */
  imageSource: string;
  /** Image width for scaling calculations */
  imageWidth?: number;
  /** Image height for scaling calculations */
  imageHeight?: number;
  /** Children rendered as overlays */
  children?: React.ReactNode;
  /** Callback when canvas size changes */
  onScaleChange?: (scale: number) => void;
  /** Optional class name */
  className?: string;
}

export function ScreenshotCanvas({
  imageSource,
  imageWidth,
  imageHeight,
  children,
  onScaleChange,
  className = "",
}: ScreenshotCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [imageDimensions, setImageDimensions] = useState({
    width: imageWidth || 0,
    height: imageHeight || 0,
  });

  // Handle image load to get dimensions
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
  };

  // Calculate scale based on container width
  useEffect(() => {
    if (!containerRef.current || !imageDimensions.width) return;

    const updateScale = () => {
      const containerWidth = containerRef.current?.clientWidth || 0;
      const newScale = containerWidth / imageDimensions.width;
      setScale(Math.min(newScale, 1)); // Don't scale up
      onScaleChange?.(Math.min(newScale, 1));
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [imageDimensions.width, onScaleChange]);

  const isBase64 =
    imageSource.startsWith("data:") || !imageSource.includes("/");
  const src =
    isBase64 && !imageSource.startsWith("data:")
      ? `data:image/png;base64,${imageSource}`
      : imageSource;

  return (
    <div ref={containerRef} className={`relative overflow-auto ${className}`}>
      <div
        className="relative"
        style={{
          width: imageDimensions.width * scale,
          height: imageDimensions.height * scale,
        }}
      >
        {/* Screenshot image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Screenshot"
          className="absolute top-0 left-0 w-full h-full"
          onLoad={handleImageLoad}
          style={{ imageRendering: "auto" }}
        />

        {/* Overlay container - scaled to match image */}
        <div
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: imageDimensions.width,
            height: imageDimensions.height,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

// Helper components for drawing overlays

interface BoundingBoxOverlayProps {
  bbox: BoundingBox;
  color?: string;
  fillColor?: string;
  strokeWidth?: number;
  label?: string;
  labelPosition?: "top" | "bottom";
  onClick?: () => void;
  isSelected?: boolean;
}

export function BoundingBoxOverlay({
  bbox,
  color = "rgb(59, 130, 246)",
  fillColor = "rgba(59, 130, 246, 0.2)",
  strokeWidth = 2,
  label,
  labelPosition = "top",
  onClick,
  isSelected = false,
}: BoundingBoxOverlayProps) {
  const actualColor = isSelected ? "rgb(34, 197, 94)" : color;
  const actualFillColor = isSelected ? "rgba(34, 197, 94, 0.3)" : fillColor;

  return (
    <div
      className={`absolute ${onClick ? "cursor-pointer pointer-events-auto" : ""}`}
      style={{
        left: bbox.x,
        top: bbox.y,
        width: bbox.width,
        height: bbox.height,
        border: `${strokeWidth}px solid ${actualColor}`,
        backgroundColor: actualFillColor,
      }}
      onClick={onClick}
    >
      {label && (
        <span
          className="absolute text-xs px-1 py-0.5 whitespace-nowrap"
          style={{
            backgroundColor: actualColor,
            color: "white",
            [labelPosition === "top" ? "bottom" : "top"]: "100%",
            left: 0,
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

interface ContourOverlayProps {
  points: [number, number][];
  color?: string;
  strokeWidth?: number;
}

export function ContourOverlay({
  points,
  color = "cyan",
  strokeWidth = 1,
}: ContourOverlayProps) {
  if (points.length < 2) return null;

  const pathData =
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ") +
    " Z";

  return (
    <svg
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
      style={{ overflow: "visible" }}
    >
      <path d={pathData} fill="none" stroke={color} strokeWidth={strokeWidth} />
    </svg>
  );
}
