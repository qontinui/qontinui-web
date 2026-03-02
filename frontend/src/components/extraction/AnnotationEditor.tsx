"use client";

import { useExtractionAnnotationStore } from "@/stores/extraction-annotation-store";
import { AnnotationCanvas } from "./_components/AnnotationCanvas";

interface AnnotationEditorProps {
  className?: string;
}

export function AnnotationEditor({ className }: AnnotationEditorProps) {
  const { screenshotUrl } = useExtractionAnnotationStore();

  if (!screenshotUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-canvas border border-border-subtle rounded-lg ${className}`}
      >
        <div className="text-center text-text-muted py-16">
          <p className="text-sm">No screenshot loaded</p>
          <p className="text-xs mt-1 opacity-60">
            Run an extraction or load a screenshot to start annotating
          </p>
        </div>
      </div>
    );
  }

  return <AnnotationCanvas className={className} />;
}
