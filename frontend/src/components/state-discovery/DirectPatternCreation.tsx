/**
 * Direct Pattern Creation Component (EXPERIMENTAL)
 * Full workflow for extracting patterns directly from snapshots
 */

"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Save,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { SnapshotMultiSelector } from "@/components/integration-testing/SnapshotMultiSelector";
import { DirectPatternRegionSelector } from "./DirectPatternRegionSelector";
import { PatternPreviewCard } from "./PatternPreviewCard";

import type { SnapshotRun } from "@/types/snapshots";
import type {
  ExtractedPattern,
  Region,
  SnapshotScreenshot,
  PatternSaveResult,
} from "@/types/direct-pattern-creation";

import { createStateImage } from "@/lib/state-image-creator";
import { useAutomation } from "@/contexts/automation-context";

export function DirectPatternCreation() {
  const { addImage } = useAutomation();

  // Step 1: Snapshot Selection
  const [selectedSnapshots, setSelectedSnapshots] = useState<SnapshotRun[]>([]);
  const [screenshots, setScreenshots] = useState<SnapshotScreenshot[]>([]);
  const [loadingScreenshots, setLoadingScreenshots] = useState(false);

  // Step 2: Pattern Extraction
  const [currentScreenshotIndex, setCurrentScreenshotIndex] = useState(0);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [extractedPatterns, setExtractedPatterns] = useState<
    ExtractedPattern[]
  >([]);
  const [extracting, setExtracting] = useState(false);

  // Step 3: Saving
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  // Load screenshots when snapshots are selected
  useEffect(() => {
    const loadScreenshots = async () => {
      if (selectedSnapshots.length === 0) {
        setScreenshots([]);
        setCurrentScreenshotIndex(0);
        return;
      }

      setLoadingScreenshots(true);
      try {
        const allScreenshots: SnapshotScreenshot[] = [];

        for (const snapshot of selectedSnapshots) {
          const response = await fetch(
            `/api/integration-testing/snapshots/${snapshot.run_id}/screenshots`
          );

          if (!response.ok) {
            throw new Error(
              `Failed to load screenshots for ${snapshot.run_id}`
            );
          }

          const data = await response.json();

          const screenshotList: SnapshotScreenshot[] = data.screenshots.map(
            (s: any, idx: number) => ({
              id: `${snapshot.run_id}_${idx}`,
              path: s.screenshot_path,
              url: `/api/integration-testing/snapshots/${snapshot.run_id}/screenshot/${s.screenshot_path}`,
              active_states: s.active_states || [],
              timestamp: s.timestamp,
              snapshotRunId: snapshot.run_id,
              snapshotName: snapshot.run_id.substring(0, 8),
              width: s.width,
              height: s.height,
            })
          );

          allScreenshots.push(...screenshotList);
        }

        setScreenshots(allScreenshots);
        setCurrentScreenshotIndex(0);
        toast.success(
          `Loaded ${allScreenshots.length} screenshots from ${selectedSnapshots.length} snapshot(s)`
        );
      } catch (error) {
        console.error("Failed to load screenshots:", error);
        toast.error("Failed to load screenshots");
        setScreenshots([]);
      } finally {
        setLoadingScreenshots(false);
      }
    };

    loadScreenshots();
  }, [selectedSnapshots]);

  // Extract pattern from current screenshot
  const handleExtractRegion = async () => {
    if (!selectedRegion || screenshots.length === 0) return;

    setExtracting(true);
    try {
      const currentScreenshot = screenshots[currentScreenshotIndex];
      if (!currentScreenshot) {
        throw new Error("No screenshot selected");
      }

      // Create a canvas to extract the region
      const img = new Image();
      img.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = currentScreenshot.url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = selectedRegion.width;
      canvas.height = selectedRegion.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("Failed to get canvas context");
      }

      // Extract the region
      ctx.drawImage(
        img,
        selectedRegion.x,
        selectedRegion.y,
        selectedRegion.width,
        selectedRegion.height,
        0,
        0,
        selectedRegion.width,
        selectedRegion.height
      );

      const imageData = canvas.toDataURL("image/png");

      // Create pattern object
      const pattern: ExtractedPattern = {
        id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `Pattern_${extractedPatterns.length + 1}`,
        imageData,
        region: { ...selectedRegion },
        sourceScreenshotIndex: currentScreenshotIndex,
        sourceScreenshotUrl: currentScreenshot.url,
        sourceSnapshotId: currentScreenshot.snapshotRunId,
        states:
          currentScreenshot.active_states.length > 0
            ? currentScreenshot.active_states
            : ["default"],
        timestamp: new Date().toISOString(),
      };

      setExtractedPatterns((prev) => [...prev, pattern]);
      setSelectedRegion(null);
      toast.success("Pattern extracted successfully");
    } catch (error) {
      console.error("Failed to extract pattern:", error);
      toast.error("Failed to extract pattern");
    } finally {
      setExtracting(false);
    }
  };

  // Delete a pattern
  const handleDeletePattern = (patternId: string) => {
    setExtractedPatterns((prev) => prev.filter((p) => p.id !== patternId));
    toast.success("Pattern deleted");
  };

  // Update a pattern
  const handleUpdatePattern = (
    patternId: string,
    updates: Partial<ExtractedPattern>
  ) => {
    setExtractedPatterns((prev) =>
      prev.map((p) => (p.id === patternId ? { ...p, ...updates } : p))
    );
  };

  // Save all patterns to the image library
  const handleSavePatterns = async () => {
    if (extractedPatterns.length === 0) return;

    setSaving(true);
    setSaveProgress(0);

    try {
      const errors: Array<{ patternId: string; error: string }> = [];
      let savedCount = 0;

      for (let i = 0; i < extractedPatterns.length; i++) {
        const pattern = extractedPatterns[i];
        if (!pattern) continue;

        try {
          // Create image asset and add to library
          const imageAsset = {
            id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: pattern.name,
            url: pattern.imageData,
            size: Math.ceil((pattern.imageData.split(",")[1]?.length || 0) * 0.75),
            createdAt: new Date(),
            usageCount: 0,
            usage: [],
            source: "image_extraction" as const,
          };

          // Add to automation context (this updates the library)
          addImage(imageAsset);

          savedCount++;
        } catch (error) {
          console.error(`Failed to save pattern ${pattern.id}:`, error);
          errors.push({
            patternId: pattern.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        setSaveProgress(Math.round(((i + 1) / extractedPatterns.length) * 100));
      }

      const result: PatternSaveResult = {
        success: errors.length === 0,
        savedPatterns: savedCount,
        errors,
      };

      if (result.success) {
        toast.success(
          `Successfully saved ${savedCount} pattern(s) to image library`
        );
        setExtractedPatterns([]);
        setSelectedSnapshots([]);
      } else {
        toast.warning(
          `Saved ${savedCount}/${extractedPatterns.length} patterns. ${errors.length} failed.`
        );
      }
    } catch (error) {
      console.error("Failed to save patterns:", error);
      toast.error("Failed to save patterns");
    } finally {
      setSaving(false);
      setSaveProgress(0);
    }
  };

  // Navigation
  const goToPrevious = () => {
    setCurrentScreenshotIndex((prev) => Math.max(0, prev - 1));
    setSelectedRegion(null);
  };

  const goToNext = () => {
    setCurrentScreenshotIndex((prev) =>
      Math.min(screenshots.length - 1, prev + 1)
    );
    setSelectedRegion(null);
  };

  // Get existing regions for current screenshot
  const existingRegions = extractedPatterns
    .filter((p) => p.sourceScreenshotIndex === currentScreenshotIndex)
    .map((p) => p.region);

  const currentScreenshot = screenshots[currentScreenshotIndex];

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-6 w-6 text-purple-600" />
        <div>
          <h2 className="text-2xl font-bold">Direct Pattern Creation</h2>
          <p className="text-sm text-gray-600">
            Extract patterns directly from snapshots without uploading
            screenshots
          </p>
        </div>
        <Badge variant="secondary" className="ml-auto">
          EXPERIMENTAL
        </Badge>
      </div>

      {/* Step 1: Select Snapshots */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
              1
            </div>
            Select Snapshot Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SnapshotMultiSelector
            selectedSnapshots={selectedSnapshots}
            onChange={setSelectedSnapshots}
          />

          {loadingScreenshots && (
            <div className="flex items-center justify-center py-4 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span>Loading screenshots...</span>
            </div>
          )}

          {screenshots.length > 0 && !loadingScreenshots && (
            <Alert className="mt-3">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Loaded {screenshots.length} screenshot
                {screenshots.length !== 1 ? "s" : ""} ready for pattern
                extraction
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Extract Patterns */}
      {screenshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
                2
              </div>
              Extract Patterns ({currentScreenshotIndex + 1}/
              {screenshots.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {/* Left: Screenshot with region selector */}
              <div className="col-span-2 space-y-3">
                {currentScreenshot && (
                  <DirectPatternRegionSelector
                    imageUrl={currentScreenshot.url}
                    onRegionSelected={setSelectedRegion}
                    existingRegions={existingRegions}
                    currentRegion={selectedRegion}
                  />
                )}

                {/* Extract button */}
                {selectedRegion && (
                  <Button
                    onClick={handleExtractRegion}
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

                {/* Navigation */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={goToPrevious}
                    disabled={currentScreenshotIndex === 0}
                    className="flex-1"
                  >
                    <ChevronLeft className="h-4 w-4 mr-2" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    onClick={goToNext}
                    disabled={currentScreenshotIndex === screenshots.length - 1}
                    className="flex-1"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>

                {/* Current screenshot info */}
                {currentScreenshot && (
                  <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
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

              {/* Right: Extracted patterns */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">
                    Extracted Patterns ({extractedPatterns.length})
                  </h4>
                </div>

                {extractedPatterns.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No patterns extracted yet</p>
                    <p className="text-xs mt-1">
                      Draw a region and click Extract
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[600px] pr-4">
                    {extractedPatterns.map((pattern, idx) => (
                      <PatternPreviewCard
                        key={pattern.id}
                        pattern={pattern}
                        index={idx}
                        onDelete={() => handleDeletePattern(pattern.id)}
                        onUpdate={(updates) =>
                          handleUpdatePattern(pattern.id, updates)
                        }
                      />
                    ))}
                  </ScrollArea>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Save */}
      {extractedPatterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
                3
              </div>
              Save Patterns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-600">
                {extractedPatterns.length} pattern
                {extractedPatterns.length !== 1 ? "s" : ""} ready to save to
                image library
              </p>
              <Button onClick={handleSavePatterns} disabled={saving} size="lg">
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save to Image Library
                  </>
                )}
              </Button>
            </div>

            {saving && (
              <div className="space-y-2">
                <Progress value={saveProgress} className="h-2" />
                <p className="text-xs text-gray-600 text-center">
                  Saving patterns... {saveProgress}%
                </p>
              </div>
            )}

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Patterns will be saved to your image library and can be used in
                state definitions. You can assign them to states after saving.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
