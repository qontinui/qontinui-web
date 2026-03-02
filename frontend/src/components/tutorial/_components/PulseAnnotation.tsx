import React from "react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationColor } from "./annotated-image-types";
import { COLOR_MAP, COLOR_HEX_MAP, SIZE_MAP } from "./annotated-image-types";

export function PulseAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = SIZE_MAP[annotation.size || "md"]?.pulse ?? 24;
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
      <div
        className="absolute rounded-full annotated-image-pulse-ring"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          backgroundColor: COLOR_HEX_MAP[color],
          opacity: 0.3,
          animationDelay: `${delay}ms`,
          animationDuration: `${duration}ms`,
        }}
      />

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
