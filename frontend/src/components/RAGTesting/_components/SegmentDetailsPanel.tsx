"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target, Layers, X } from "lucide-react";
import type { SegmentWithMatches } from "@/types/rag-testing";
import { getScoreColor, formatScore } from "../rag-testing-utils";

interface SegmentDetailsPanelProps {
  selectedSegment: SegmentWithMatches | undefined;
}

export function SegmentDetailsPanel({
  selectedSegment,
}: SegmentDetailsPanelProps) {
  if (!selectedSegment) {
    return (
      <Card className="bg-surface-raised/50 border-border-default">
        <CardContent className="py-8 text-center text-text-muted">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Click a segment to view details</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-surface-raised/50 border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Segment Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex justify-between">
            <span className="text-text-muted">ID:</span>
            <span className="font-mono">{selectedSegment.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Position:</span>
            <span>
              ({selectedSegment.bbox.x}, {selectedSegment.bbox.y})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Size:</span>
            <span>
              {selectedSegment.bbox.width} x {selectedSegment.bbox.height}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Mask Density:</span>
            <span>{(selectedSegment.mask_density * 100).toFixed(1)}%</span>
          </div>
          {selectedSegment.text_description && (
            <div>
              <span className="text-text-muted block mb-1">
                Segment Description:
              </span>
              <p className="text-text-secondary bg-black/20 rounded p-2">
                {selectedSegment.text_description}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Match Scores */}
      {selectedSegment.matches.length > 0 ? (
        <MatchScoresCard matches={selectedSegment.matches} />
      ) : (
        <Card className="bg-surface-raised/50 border-border-default">
          <CardContent className="py-8 text-center text-text-muted">
            <X className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No matches found for this segment</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

interface MatchScoresCardProps {
  matches: SegmentWithMatches["matches"];
}

function MatchScoresCard({ matches }: MatchScoresCardProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4" />
          Match Scores ({matches.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {matches.map((match, idx) => (
          <div
            key={`${match.element_id}-${idx}`}
            className="p-3 rounded-lg border border-border-default space-y-3"
          >
            <div>
              <div
                className="font-medium text-sm"
                style={{ color: getScoreColor(match.score) }}
              >
                {match.element_name}
              </div>
              {match.text_description && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">
                  {match.text_description}
                </p>
              )}
            </div>

            {/* Score bars */}
            <div className="space-y-2">
              <ScoreBar label="Combined" score={match.score} />
              <ScoreBar label="Visual" score={match.visual_similarity} />
              {match.text_similarity !== null && (
                <ScoreBar label="Text" score={match.text_similarity} />
              )}
              {match.ocr_similarity !== null && (
                <ScoreBar label="OCR" score={match.ocr_similarity} />
              )}
            </div>

            {match.ocr_text && (
              <div className="text-xs">
                <span className="text-text-muted">OCR Text: </span>
                <span className="text-text-default">
                  &quot;{match.ocr_text}&quot;
                </span>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

interface ScoreBarProps {
  label: string;
  score: number;
}

function ScoreBar({ label, score }: ScoreBarProps) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-text-muted">{label}</span>
        <span style={{ color: getScoreColor(score) }}>
          {formatScore(score)}
        </span>
      </div>
      <Progress value={score * 100} className="h-2" />
    </div>
  );
}
