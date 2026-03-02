"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useImageScale } from "./_hooks/use-image-scale";
import { HighlightAnnotation } from "./_components/HighlightAnnotation";
import { ArrowAnnotation } from "./_components/ArrowAnnotation";
import { PulseAnnotation } from "./_components/PulseAnnotation";
import { LabelAnnotation } from "./_components/LabelAnnotation";

export type {
  AnnotationType,
  AnnotationColor,
  ArrowDirection,
  Annotation,
  AnnotatedImageProps,
} from "./_components/annotated-image-types";

import type {
  AnnotatedImageProps,
  Annotation,
} from "./_components/annotated-image-types";

function scaleAnnotation(annotation: Annotation, scale: number): Annotation {
  return {
    ...annotation,
    x: annotation.x * scale,
    y: annotation.y * scale,
    width: annotation.width ? annotation.width * scale : undefined,
    height: annotation.height ? annotation.height * scale : undefined,
  };
}

export const AnnotatedImage = React.forwardRef<
  HTMLDivElement,
  AnnotatedImageProps
>(function AnnotatedImage(
  { src, alt, annotations, className, imageClassName, containerClassName },
  ref
) {
  const { scale, imgRef } = useImageScale();

  return (
    <div
      ref={ref}
      className={cn("relative inline-block", containerClassName)}
      role="region"
      aria-label={`Annotated image: ${alt}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
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

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius: "calc(0.5rem - 1px)",
          overflow: "hidden",
        }}
        aria-hidden="false"
      >
        {annotations.map((annotation, index) => {
          const color = annotation.color || "cyan";
          const scaled = scaleAnnotation(annotation, scale);

          return (
            <div key={`annotation-${index}`} className={cn(className)}>
              {annotation.type === "highlight" && (
                <HighlightAnnotation annotation={scaled} color={color} />
              )}
              {annotation.type === "arrow" && (
                <ArrowAnnotation annotation={scaled} color={color} />
              )}
              {annotation.type === "pulse" && (
                <PulseAnnotation annotation={scaled} color={color} />
              )}
              {annotation.type === "label" && (
                <LabelAnnotation annotation={scaled} color={color} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

AnnotatedImage.displayName = "AnnotatedImage";
