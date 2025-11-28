"use client";

import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ExtractionProgressProps {
  pagesVisited: number;
  statesFound: number;
  elementsFound: number;
}

export function ExtractionProgress({
  pagesVisited,
  statesFound,
  elementsFound,
}: ExtractionProgressProps) {
  return (
    <div className="flex items-center gap-4">
      <Loader2 className="h-4 w-4 animate-spin" />
      <div className="flex gap-2">
        <Badge variant="secondary">Pages: {pagesVisited}</Badge>
        <Badge variant="secondary">States: {statesFound}</Badge>
        <Badge variant="secondary">Elements: {elementsFound}</Badge>
      </div>
    </div>
  );
}
