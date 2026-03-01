"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SegmentWithMatches } from "@/types/rag-testing";
import { getScoreColor, formatScore } from "../rag-testing-utils";

interface SegmentListPanelProps {
  segments: SegmentWithMatches[];
  selectedSegmentId: string | null;
  setSelectedSegmentId: (id: string) => void;
}

export function SegmentListPanel({
  segments,
  selectedSegmentId,
  setSelectedSegmentId,
}: SegmentListPanelProps) {
  if (segments.length === 0) return null;

  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          All Segments ({segments.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64">
          <div className="space-y-1">
            {segments.map((segment) => (
              <div
                key={segment.id}
                className={cn(
                  "flex items-center justify-between p-2 rounded cursor-pointer transition-colors text-xs",
                  selectedSegmentId === segment.id
                    ? "bg-brand-primary/20 border border-brand-primary/50"
                    : "hover:bg-surface-raised/50"
                )}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedSegmentId(segment.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedSegmentId(segment.id);
                  }
                }}
              >
                <span className="font-mono">{segment.id}</span>
                {segment.bestMatch ? (
                  <Badge
                    style={{
                      backgroundColor: `${getScoreColor(segment.bestMatch.score)}20`,
                      color: getScoreColor(segment.bestMatch.score),
                      borderColor: getScoreColor(segment.bestMatch.score),
                    }}
                    variant="outline"
                  >
                    {formatScore(segment.bestMatch.score)}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="opacity-50">
                    No match
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
