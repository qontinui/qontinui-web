"use client";

import { useEffect, useRef } from "react";
import mermaid from "mermaid";

interface MermaidDiagramProps {
  source: string;
  title?: string;
}

export function MermaidDiagram({ source, title }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: true, theme: "base", securityLevel: "strict" });
    mermaid.contentLoaded();
  }, []);

  return (
    <div ref={containerRef} aria-label={title ?? "Project diagram"} className="flex justify-center overflow-auto rounded-lg border bg-card p-6">
      <div className="mermaid">{source}</div>
    </div>
  );
}
