"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";

interface ImageCounts {
  all: number;
  uploaded: number;
  pattern_optimization: number;
  image_extraction: number;
  state_discovery: number;
}

interface SourceFilterBadgesProps {
  activeFilter: string | null;
  setActiveFilter: (filter: string | null) => void;
  imageCounts: ImageCounts;
}

export function SourceFilterBadges({
  activeFilter,
  setActiveFilter,
  imageCounts,
}: SourceFilterBadgesProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Badge
        variant={activeFilter === null ? "default" : "outline"}
        className={`cursor-pointer transition-all ${
          activeFilter === null
            ? "bg-brand-success text-black border-brand-success"
            : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
        }`}
        onClick={() => setActiveFilter(null)}
      >
        All ({imageCounts.all})
      </Badge>
      <Badge
        variant={activeFilter === "uploaded" ? "default" : "outline"}
        className={`cursor-pointer transition-all ${
          activeFilter === "uploaded"
            ? "bg-brand-success text-black border-brand-success"
            : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
        }`}
        onClick={() => setActiveFilter("uploaded")}
      >
        Uploaded ({imageCounts.uploaded})
      </Badge>
      <Badge
        variant={
          activeFilter === "pattern_optimization" ? "default" : "outline"
        }
        className={`cursor-pointer transition-all ${
          activeFilter === "pattern_optimization"
            ? "bg-brand-primary text-black border-brand-primary"
            : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
        }`}
        onClick={() => setActiveFilter("pattern_optimization")}
      >
        Pattern Opt ({imageCounts.pattern_optimization})
      </Badge>
      <Badge
        variant={activeFilter === "image_extraction" ? "default" : "outline"}
        className={`cursor-pointer transition-all ${
          activeFilter === "image_extraction"
            ? "bg-brand-secondary text-black border-brand-secondary"
            : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
        }`}
        onClick={() => setActiveFilter("image_extraction")}
      >
        Extraction ({imageCounts.image_extraction})
      </Badge>
      <Badge
        variant={activeFilter === "state_discovery" ? "default" : "outline"}
        className={`cursor-pointer transition-all ${
          activeFilter === "state_discovery"
            ? "bg-brand-warning text-black border-brand-warning"
            : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
        }`}
        onClick={() => setActiveFilter("state_discovery")}
      >
        Discovery ({imageCounts.state_discovery})
      </Badge>
    </div>
  );
}
