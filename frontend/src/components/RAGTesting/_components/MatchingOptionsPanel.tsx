"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Target, RefreshCw, Layers } from "lucide-react";
import type { MatchingStrategy } from "@/types/rag-testing";

interface MatchingOptionsPanelProps {
  isSegmentationOnly: boolean;
  matchingStrategy: MatchingStrategy;
  setMatchingStrategy: (strategy: MatchingStrategy) => void;
  similarityThreshold: number;
  setSimilarityThreshold: (threshold: number) => void;
  useOCR: boolean;
  setUseOCR: (use: boolean) => void;
  isAnalyzing: boolean;
  hasScreenshot: boolean;
  onRunAnalysis: () => void;
}

export function MatchingOptionsPanel({
  isSegmentationOnly,
  matchingStrategy,
  setMatchingStrategy,
  similarityThreshold,
  setSimilarityThreshold,
  useOCR,
  setUseOCR,
  isAnalyzing,
  hasScreenshot,
  onRunAnalysis,
}: MatchingOptionsPanelProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {isSegmentationOnly ? "Run" : "Matching Options"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isSegmentationOnly && (
          <>
            <div>
              <Label className="text-xs">Strategy</Label>
              <Select
                value={matchingStrategy}
                onValueChange={(v) =>
                  setMatchingStrategy(v as MatchingStrategy)
                }
              >
                <SelectTrigger className="mt-1 bg-surface-raised border-border-default">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="average">Combined Embeddings</SelectItem>
                  <SelectItem value="any_match">Individual Patterns</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-text-muted mt-1">
                {matchingStrategy === "average"
                  ? "Average all pattern embeddings"
                  : "Match if any pattern exceeds threshold"}
              </p>
            </div>

            <div>
              <Label className="text-xs">
                Similarity Threshold: {similarityThreshold.toFixed(2)}
              </Label>
              <Slider
                value={[similarityThreshold]}
                onValueChange={([v]) => setSimilarityThreshold(v ?? 0.7)}
                min={0}
                max={1}
                step={0.05}
                className="mt-1"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Enable OCR</Label>
              <Switch checked={useOCR} onCheckedChange={setUseOCR} />
            </div>
          </>
        )}

        <Button
          onClick={onRunAnalysis}
          disabled={!hasScreenshot || isAnalyzing}
          className="w-full bg-brand-primary hover:bg-brand-primary/80 text-black"
        >
          {isAnalyzing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              {isSegmentationOnly ? "Segmenting..." : "Analyzing..."}
            </>
          ) : (
            <>
              {isSegmentationOnly ? (
                <Layers className="w-4 h-4 mr-2" />
              ) : (
                <Target className="w-4 h-4 mr-2" />
              )}
              {isSegmentationOnly ? "Run Segmentation" : "Run Analysis"}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
