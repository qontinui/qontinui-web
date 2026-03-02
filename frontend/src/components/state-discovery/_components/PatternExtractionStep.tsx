import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { DirectPatternRegionSelector } from "../DirectPatternRegionSelector";
import { PatternPreviewCard } from "../PatternPreviewCard";
import type {
  ExtractedPattern,
  Region,
  SnapshotScreenshot,
} from "@/types/direct-pattern-creation";

interface PatternExtractionStepProps {
  screenshots: SnapshotScreenshot[];
  currentScreenshotIndex: number;
  currentScreenshot: SnapshotScreenshot | undefined;
  selectedRegion: Region | null;
  onRegionSelected: (region: Region | null) => void;
  existingRegions: Region[];
  extracting: boolean;
  extractedPatterns: ExtractedPattern[];
  onExtractRegion: () => void;
  onDeletePattern: (patternId: string) => void;
  onUpdatePattern: (
    patternId: string,
    updates: Partial<ExtractedPattern>
  ) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export default function PatternExtractionStep({
  screenshots,
  currentScreenshotIndex,
  currentScreenshot,
  selectedRegion,
  onRegionSelected,
  existingRegions,
  extracting,
  extractedPatterns,
  onExtractRegion,
  onDeletePattern,
  onUpdatePattern,
  onPrevious,
  onNext,
}: PatternExtractionStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
            2
          </div>
          Extract Patterns ({currentScreenshotIndex + 1}/{screenshots.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            {currentScreenshot && (
              <DirectPatternRegionSelector
                imageUrl={currentScreenshot.url}
                onRegionSelected={onRegionSelected}
                existingRegions={existingRegions}
                currentRegion={selectedRegion}
              />
            )}

            {selectedRegion && (
              <Button
                onClick={onExtractRegion}
                disabled={extracting}
                className="w-full"
                size="lg"
              >
                {extracting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Extracting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Extract This Region
                  </>
                )}
              </Button>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onPrevious}
                disabled={currentScreenshotIndex === 0}
                className="flex-1"
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={onNext}
                disabled={currentScreenshotIndex === screenshots.length - 1}
                className="flex-1"
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>

            {currentScreenshot && (
              <div className="text-xs text-text-muted bg-surface-canvas p-2 rounded">
                <div className="font-medium">
                  {currentScreenshot.snapshotName} - Screenshot{" "}
                  {currentScreenshotIndex + 1}
                </div>
                {currentScreenshot.active_states.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span>States:</span>
                    {currentScreenshot.active_states.map((state) => (
                      <Badge
                        key={state}
                        variant="secondary"
                        className="text-xs"
                      >
                        {state}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">
                Extracted Patterns ({extractedPatterns.length})
              </h4>
            </div>

            {extractedPatterns.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No patterns extracted yet</p>
                <p className="text-xs mt-1">Draw a region and click Extract</p>
              </div>
            ) : (
              <ScrollArea className="h-[600px] pr-4">
                {extractedPatterns.map((pattern, idx) => (
                  <PatternPreviewCard
                    key={pattern.id}
                    pattern={pattern}
                    index={idx}
                    onDelete={() => onDeletePattern(pattern.id)}
                    onUpdate={(updates) => onUpdatePattern(pattern.id, updates)}
                  />
                ))}
              </ScrollArea>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
