"use client";

/**
 * Mermaid Diagram Component
 *
 * Renders Mermaid diagrams with proper initialization and error handling
 */

import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import DOMPurify from "dompurify";

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

export function MermaidDiagram({ chart, id }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient || !ref.current) return;

    const renderDiagram = async () => {
      try {
        // Initialize mermaid with configuration
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: 14,
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: "basis",
          },
          sequence: {
            useMaxWidth: true,
          },
          er: {
            useMaxWidth: true,
          },
        });

        // Generate unique ID
        const diagramId =
          id || `mermaid-${Math.random().toString(36).substr(2, 9)}`;

        // Render the diagram
        const { svg } = await mermaid.render(diagramId, chart);

        if (ref.current) {
          // Sanitize SVG to prevent XSS attacks
          ref.current.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          });
        }
        setError(null);
      } catch (err) {
        console.error("Mermaid rendering error:", err);
        setError(
          err instanceof Error ? err.message : "Failed to render diagram"
        );
      }
    };

    renderDiagram();
  }, [chart, id, isClient]);

  if (!isClient) {
    return (
      <div className="flex items-center justify-center p-8 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">Loading diagram...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <p className="text-sm text-destructive font-medium">
          Failed to render diagram
        </p>
        <p className="text-xs text-destructive/80 mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="mermaid-container flex items-center justify-center p-4 overflow-x-auto"
      style={{ minHeight: "200px" }}
    />
  );
}
