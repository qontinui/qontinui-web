"use client";

import React, { useState, useRef, useEffect, CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Supported annotation types for AnnotatedImage
 */
export type AnnotationType = "highlight" | "arrow" | "pulse" | "label";

/**
 * Color options for annotations
 * Uses Qontinui brand colors by default
 */
export type AnnotationColor =
  | "cyan"
  | "green"
  | "purple"
  | "red"
  | "yellow"
  | "blue";

/**
 * Arrow direction for arrow annotations
 */
export type ArrowDirection =
  | "up"
  | "down"
  | "left"
  | "right"
  | "up-left"
  | "up-right"
  | "down-left"
  | "down-right";

/**
 * Individual annotation configuration
 */
export interface Annotation {
  type: AnnotationType;
  x: number; // x position in pixels
  y: number; // y position in pixels
  width?: number; // width for highlight/arrow
  height?: number; // height for highlight/arrow
  color?: AnnotationColor; // color for annotation (default: cyan)
  label?: string; // text label for label type
  size?: "sm" | "md" | "lg"; // size for pulse/arrow
  direction?: ArrowDirection; // direction for arrow type
  opacity?: number; // opacity for highlight (0-1)
  duration?: number; // animation duration in ms
  delay?: number; // animation delay in ms
}

/**
 * Props for AnnotatedImage component
 */
export interface AnnotatedImageProps {
  src: string;
  alt: string;
  annotations: Annotation[];
  className?: string;
  imageClassName?: string;
  containerClassName?: string;
}

/**
 * Color mapping to Qontinui and Tailwind classes
 */
const COLOR_MAP: Record<
  AnnotationColor,
  { bg: string; text: string; border: string; ring: string }
> = {
  cyan: {
    bg: "bg-qontinui-cyan/20",
    text: "text-qontinui-cyan",
    border: "border-qontinui-cyan",
    ring: "ring-qontinui-cyan",
  },
  green: {
    bg: "bg-qontinui-green/20",
    text: "text-qontinui-green",
    border: "border-qontinui-green",
    ring: "ring-qontinui-green",
  },
  purple: {
    bg: "bg-qontinui-purple/20",
    text: "text-qontinui-purple",
    border: "border-qontinui-purple",
    ring: "ring-qontinui-purple",
  },
  red: {
    bg: "bg-red-500/20",
    text: "text-red-500",
    border: "border-red-500",
    ring: "ring-red-500",
  },
  yellow: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-500",
    border: "border-yellow-500",
    ring: "ring-yellow-500",
  },
  blue: {
    bg: "bg-blue-500/20",
    text: "text-blue-500",
    border: "border-blue-500",
    ring: "ring-blue-500",
  },
};

/**
 * Size mapping for pulse and arrow annotations
 */
const SIZE_MAP: Record<
  string,
  { pulse: number; arrow: number; label: string }
> = {
  sm: { pulse: 16, arrow: 24, label: "text-xs" },
  md: { pulse: 24, arrow: 32, label: "text-sm" },
  lg: { pulse: 32, arrow: 40, label: "text-base" },
};

/**
 * Arrow direction to rotation angle mapping
 */
const ARROW_ROTATION_MAP: Record<ArrowDirection, number> = {
  up: 0,
  "up-right": 45,
  right: 90,
  "down-right": 135,
  down: 180,
  "down-left": 225,
  left: 270,
  "up-left": 315,
};

/**
 * Pulse animation styles injected into global scope
 */
const PULSE_ANIMATION_STYLES = `
  @keyframes annotated-image-pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.2);
    }
  }

  @keyframes annotated-image-pulse-ring {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }

  .annotated-image-pulse {
    animation: annotated-image-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  .annotated-image-pulse-ring {
    animation: annotated-image-pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
`;

/**
 * Highlight annotation component
 */
function HighlightAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const opacity = annotation.opacity ?? 0.3;
  const colors = COLOR_MAP[color];

  return (
    <div
      className={cn(
        "absolute border-2 rounded-lg pointer-events-none",
        colors.border
      )}
      style={{
        left: `${annotation.x}px`,
        top: `${annotation.y}px`,
        width: `${annotation.width || 100}px`,
        height: `${annotation.height || 100}px`,
        backgroundColor: `rgba(var(--qontinui-${color}), ${opacity})`,
      }}
      role="img"
      aria-label={`Highlighted area at ${annotation.x}, ${annotation.y}`}
    />
  );
}

/**
 * Arrow annotation component using CSS arrow
 */
function ArrowAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = SIZE_MAP[annotation.size || "md"].arrow;
  const direction = annotation.direction || "down";
  const rotation = ARROW_ROTATION_MAP[direction];
  const colors = COLOR_MAP[color];

  return (
    <div
      className={cn(
        "absolute pointer-events-none flex items-center justify-center"
      )}
      style={{
        left: `${annotation.x}px`,
        top: `${annotation.y}px`,
        width: `${size}px`,
        height: `${size}px`,
      }}
      role="img"
      aria-label={`Arrow pointing ${direction} at ${annotation.x}, ${annotation.y}`}
    >
      {/* Arrow using SVG for better rendering */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        className="absolute"
        style={{
          transform: `rotate(${rotation}deg)`,
          filter: `drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))`,
        }}
        aria-hidden="true"
      >
        {/* Arrow shaft */}
        <line
          x1="16"
          y1="4"
          x2="16"
          y2="20"
          stroke={`rgb(var(--qontinui-${color}))`}
          strokeWidth="2"
          strokeLinecap="round"
        />
        {/* Arrow head */}
        <polygon
          points="16,4 12,12 20,12"
          fill={`rgb(var(--qontinui-${color}))`}
        />
      </svg>
    </div>
  );
}

/**
 * Pulse annotation component with animated dot and ring
 */
function PulseAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = SIZE_MAP[annotation.size || "md"].pulse;
  const duration = annotation.duration ?? 2000;
  const delay = annotation.delay ?? 0;
  const colors = COLOR_MAP[color];

  return (
    <div
      className="absolute pointer-events-none flex items-center justify-center"
      style={{
        left: `${annotation.x - size / 2}px`,
        top: `${annotation.y - size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
      }}
      role="img"
      aria-label={`Pulsing indicator at ${annotation.x}, ${annotation.y}`}
    >
      {/* Outer pulse ring */}
      <div
        className="absolute rounded-full annotated-image-pulse-ring"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: `rgb(var(--qontinui-${color}))`,
          opacity: 0.3,
          animationDelay: `${delay}ms`,
          animationDuration: `${duration}ms`,
        }}
      />

      {/* Pulsing dot */}
      <div
        className={cn(
          "absolute rounded-full annotated-image-pulse",
          colors.bg,
          colors.border,
          "border-2"
        )}
        style={{
          width: `${size * 0.6}px`,
          height: `${size * 0.6}px`,
          animationDelay: `${delay}ms`,
          animationDuration: `${duration}ms`,
        }}
      />

      {/* Static center dot */}
      <div
        className={cn(
          "absolute rounded-full",
          colors.bg,
          colors.border,
          "border-2"
        )}
        style={{
          width: `${size * 0.3}px`,
          height: `${size * 0.3}px`,
        }}
      />
    </div>
  );
}

/**
 * Label annotation component
 */
function LabelAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = annotation.size || "md";
  const colors = COLOR_MAP[color];
  const sizeClass = SIZE_MAP[size].label;
  const offsetX = annotation.width ? annotation.width / 2 : 0;
  const offsetY = annotation.height ? annotation.height / 2 : 0;

  return (
    <div
      className={cn(
        "absolute px-3 py-1.5 rounded-md font-medium pointer-events-none whitespace-nowrap",
        "border-2 bg-background/95 backdrop-blur-sm shadow-lg",
        colors.border,
        sizeClass
      )}
      style={{
        left: `${annotation.x + offsetX}px`,
        top: `${annotation.y + offsetY}px`,
        transform: "translate(-50%, -50%)",
      }}
      role="tooltip"
      aria-label={`Label: ${annotation.label}`}
    >
      <span className={colors.text}>{annotation.label}</span>
    </div>
  );
}

/**
 * AnnotatedImage Component
 *
 * Displays an image with interactive annotations including highlights,
 * arrows, pulsing indicators, and labels.
 *
 * @example
 * ```tsx
 * <AnnotatedImage
 *   src="/screenshot.png"
 *   alt="Tutorial screenshot"
 *   annotations={[
 *     {
 *       type: "highlight",
 *       x: 100,
 *       y: 100,
 *       width: 200,
 *       height: 150,
 *       color: "cyan",
 *     },
 *     {
 *       type: "pulse",
 *       x: 300,
 *       y: 200,
 *       color: "green",
 *       size: "lg",
 *     },
 *     {
 *       type: "label",
 *       x: 100,
 *       y: 50,
 *       label: "Click here",
 *       color: "purple",
 *     },
 *   ]}
 * />
 * ```
 */
export const AnnotatedImage = React.forwardRef<
  HTMLDivElement,
  AnnotatedImageProps
>(function AnnotatedImage(
  { src, alt, annotations, className, imageClassName, containerClassName },
  ref
) {
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);

  // Inject animation styles on mount
  useEffect(() => {
    const styleId = "annotated-image-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = PULSE_ANIMATION_STYLES;
      document.head.appendChild(style);
    }
  }, []);

  // Calculate scale based on actual image dimensions
  useEffect(() => {
    const handleImageLoad = () => {
      if (imgRef.current) {
        const naturalWidth = imgRef.current.naturalWidth;
        const displayWidth = imgRef.current.offsetWidth;
        if (displayWidth > 0) {
          setScale(displayWidth / naturalWidth);
        }
      }
    };

    const img = imgRef.current;
    if (img) {
      if (img.complete) {
        handleImageLoad();
      } else {
        img.addEventListener("load", handleImageLoad);
        return () => img.removeEventListener("load", handleImageLoad);
      }
    }
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative inline-block", containerClassName)}
      role="region"
      aria-label={`Annotated image: ${alt}`}
    >
      {/* Base image */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={cn(
          "rounded-lg border border-border shadow-lg",
          "max-w-full h-auto display-block",
          imageClassName
        )}
        loading="lazy"
      />

      {/* Annotations overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius: "calc(0.5rem - 1px)", // Match image border radius
          overflow: "hidden",
        }}
        aria-hidden="false"
      >
        {annotations.map((annotation, index) => {
          const color = annotation.color || "cyan";

          // Scaled positions for responsive rendering
          const scaledX = annotation.x * scale;
          const scaledY = annotation.y * scale;
          const scaledWidth = annotation.width
            ? annotation.width * scale
            : undefined;
          const scaledHeight = annotation.height
            ? annotation.height * scale
            : undefined;

          const scaledAnnotation = {
            ...annotation,
            x: scaledX,
            y: scaledY,
            width: scaledWidth,
            height: scaledHeight,
          };

          return (
            <div key={`annotation-${index}`} className={cn(className)}>
              {annotation.type === "highlight" && (
                <HighlightAnnotation
                  annotation={scaledAnnotation}
                  color={color}
                />
              )}

              {annotation.type === "arrow" && (
                <ArrowAnnotation annotation={scaledAnnotation} color={color} />
              )}

              {annotation.type === "pulse" && (
                <PulseAnnotation annotation={scaledAnnotation} color={color} />
              )}

              {annotation.type === "label" && (
                <LabelAnnotation annotation={scaledAnnotation} color={color} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

AnnotatedImage.displayName = "AnnotatedImage";
