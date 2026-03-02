import React from "react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationColor } from "./annotated-image-types";
import {
  SIZE_MAP,
  COLOR_HEX_MAP,
  ARROW_ROTATION_MAP,
} from "./annotated-image-types";

export function ArrowAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = SIZE_MAP[annotation.size || "md"]?.arrow ?? 32;
  const direction = annotation.direction || "down";
  const rotation = ARROW_ROTATION_MAP[direction];

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
        <line
          x1="16"
          y1="4"
          x2="16"
          y2="20"
          stroke={COLOR_HEX_MAP[color]}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polygon points="16,4 12,12 20,12" fill={COLOR_HEX_MAP[color]} />
      </svg>
    </div>
  );
}
