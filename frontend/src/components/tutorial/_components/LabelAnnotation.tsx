import React from "react";
import { cn } from "@/lib/utils";
import type { Annotation, AnnotationColor } from "./annotated-image-types";
import { COLOR_MAP, SIZE_MAP } from "./annotated-image-types";

export function LabelAnnotation({
  annotation,
  color,
}: {
  annotation: Annotation;
  color: AnnotationColor;
}) {
  const size = annotation.size || "md";
  const colors = COLOR_MAP[color];
  const sizeClass = SIZE_MAP[size]?.label ?? "text-sm";
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
