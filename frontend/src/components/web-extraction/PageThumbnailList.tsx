/**
 * Page Thumbnail List Component
 *
 * Displays a slim vertical list of page thumbnails from extraction.
 * Clicking a thumbnail selects that page to show its states.
 */

"use client";

import { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, AlertCircle } from "lucide-react";
import { runnerClient } from "@/lib/runner-client";
import type { ExtractionAnnotation } from "@/services/extraction-service";

interface PageThumbnailListProps {
  annotations: ExtractionAnnotation[];
  extractionId: string;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (annotationId: string) => void;
}

function PageThumbnail({
  annotation,
  extractionId,
  isSelected,
  onClick,
}: {
  annotation: ExtractionAnnotation;
  extractionId: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadThumbnail() {
      try {
        setLoading(true);
        setError(false);
        const result = await runnerClient.getExtractionScreenshot(
          extractionId,
          annotation.screenshot_id
        );
        if (!mounted) return;

        if (result.success && result.blob) {
          const url = URL.createObjectURL(result.blob);
          setImageUrl(url);
        } else {
          setError(true);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadThumbnail();

    return () => {
      mounted = false;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [extractionId, annotation.screenshot_id]);

  // Get hostname from URL
  const getHostname = () => {
    if (!annotation.source_url) return "Unknown";
    try {
      return new URL(annotation.source_url).hostname;
    } catch {
      return annotation.source_url.slice(0, 15) || "Unknown";
    }
  };

  const stateCount =
    (annotation.states as { id: string }[] | undefined)?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-2 rounded-lg transition-all text-left ${
        isSelected
          ? "bg-brand-primary/20 ring-2 ring-brand-primary"
          : "hover:bg-muted/80"
      }`}
      title={annotation.source_url}
    >
      {/* Thumbnail */}
      <div className="aspect-[16/10] rounded-md overflow-hidden bg-muted mb-2">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="h-8 w-8 text-muted-foreground animate-pulse" />
          </div>
        ) : error || !imageUrl ? (
          <div className="w-full h-full flex items-center justify-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
          </div>
        ) : (
          <img
            src={imageUrl}
            alt={annotation.source_url}
            className="w-full h-full object-cover object-top"
          />
        )}
      </div>

      {/* Info */}
      <div className="space-y-0.5">
        <p
          className="text-xs font-medium truncate leading-tight"
          title={getHostname()}
        >
          {getHostname()}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {stateCount} state{stateCount !== 1 ? "s" : ""}
        </p>
      </div>
    </button>
  );
}

export function PageThumbnailList({
  annotations,
  extractionId,
  selectedAnnotationId,
  onSelectAnnotation,
}: PageThumbnailListProps) {
  if (annotations.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-2">
        <p className="text-xs text-muted-foreground text-center">No pages</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-3">
        {annotations.map((annotation) => (
          <PageThumbnail
            key={annotation.screenshot_id}
            annotation={annotation}
            extractionId={extractionId}
            isSelected={selectedAnnotationId === annotation.screenshot_id}
            onClick={() => onSelectAnnotation(annotation.screenshot_id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
