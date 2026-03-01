"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SegmentWithMatches, RAGFindMatch } from "@/types/rag-testing";

interface ResultsSummaryPanelProps {
  segments: SegmentWithMatches[];
  allMatches: RAGFindMatch[];
  processingTime: number;
}

export function ResultsSummaryPanel({
  segments,
  allMatches,
  processingTime,
}: ResultsSummaryPanelProps) {
  if (segments.length === 0) return null;

  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-text-muted">Segments:</span>
          <span>{segments.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Matches:</span>
          <span>{allMatches.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Processing:</span>
          <span>{processingTime.toFixed(0)}ms</span>
        </div>
      </CardContent>
    </Card>
  );
}
