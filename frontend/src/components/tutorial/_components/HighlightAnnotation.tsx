import React from "react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationColor } from "./annotated-image-types";
import { COLOR_MAP, COLOR_HEX_MAP } from "./annotated-image-types";

export function HighlightAnnotation({
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
        backgroundColor: `color-mix(in srgb, ${COLOR_HEX_MAP[color]} ${Math.round(opacity * 100)}%, transparent)`,
      }}
      role="img"
      aria-label={`Highlighted area at ${annotation.x}, ${annotation.y}`}
    />
  );
}
