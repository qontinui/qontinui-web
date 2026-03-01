"use client";

/**
 * Left panel for the State Discovery tab.
 * Contains: screenshot uploader, similarity threshold slider, region selection,
 * analysis button, analysis results stats, state selector, and pixel filters.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Play, CropIcon, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

import ScreenshotUploader from "../ScreenshotUploader";
import type { LeftPanelProps } from "../state-discovery-types";

const LeftPanel: React.FC<LeftPanelProps> = ({
  // Screenshots
  screenshots,
  selectedScreenshotIndex,
  onSelectScreenshot,
  onScreenshotUpload,
  // Similarity threshold
  similarityThreshold,
  onSimilarityThresholdChange,
  // Region selection
  showRegionSelector,
  onToggleRegionSelector,
  selectedRegion,
  onClearRegion,
  // Analysis
  onStartAnalysis,
  uploadId,
  isAnalyzing,
  analysisProgress,
  analysisResult,
  // Filter data
  filteredStates,
  filteredStateImages,
  allStatesCount,
  allStateImagesCount,
  // State selection
  selectedState,
  onSelectState,
  // Pixel filters
  stateImages,
  maxDarkPixelPercentage,
  onMaxDarkPixelPercentageChange,
  maxLightPixelPercentage,
  onMaxLightPixelPercentageChange,
  onResetFilters,
  isFilterActive,
}) => {
  return (
    <div className="w-64 border-r p-4 overflow-y-auto">
      <ScreenshotUploader
        onUpload={onScreenshotUpload}
        screenshots={screenshots}
        selectedIndex={selectedScreenshotIndex}
        onSelectScreenshot={onSelectScreenshot}
      />

      {/* Similarity Threshold Slider */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Similarity Threshold</Label>
          <span className="text-sm text-text-muted">
            {similarityThreshold.toFixed(2)}
          </span>
        </div>
        <Slider
          value={[similarityThreshold]}
          onValueChange={([value]) =>
            onSimilarityThresholdChange(value ?? 0.85)
          }
          min={0}
          max={1}
          step={0.01}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-text-muted">
          <span>Loose (0.00)</span>
          <span>Strict (1.00)</span>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Lower values find more variations, higher values require exact matches
        </p>
      </div>

      {/* Region Selection Toggle */}
      {screenshots.length > 0 && (
        <div className="mt-4">
          <Button
            className="w-full"
            variant={showRegionSelector ? "secondary" : "outline"}
            onClick={onToggleRegionSelector}
          >
            <CropIcon className="mr-2 h-4 w-4" />
            {showRegionSelector ? "Hide" : "Select"} Analysis Region
          </Button>

          {selectedRegion && (
            <div className="mt-2 p-2 bg-blue-50 rounded text-xs">
              <div className="font-medium">Selected Region:</div>
              <div className="text-text-muted">
                Position: ({selectedRegion.x}, {selectedRegion.y})
              </div>
              <div className="text-text-muted">
                Size: {selectedRegion.width} x {selectedRegion.height}px
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="w-full mt-1"
                onClick={onClearRegion}
              >
                Clear Selection
              </Button>
            </div>
          )}
        </div>
      )}

      <Button
        className="w-full mt-4"
        onClick={onStartAnalysis}
        disabled={screenshots.length < 2 || isAnalyzing}
        title={
          Boolean(!uploadId) ? "Upload screenshots first" : "Start analysis"
        }
      >
        <Play className="mr-2 h-4 w-4" />
        Run Analysis {selectedRegion ? "(Region)" : ""}
      </Button>

      {screenshots.length > 0 &&
        (uploadId ? (
          <div className="mt-2 text-xs text-center">
            <span className="text-green-600">
              &#10003; Screenshots uploaded
            </span>
          </div>
        ) : (
          <div className="mt-2 text-xs text-center">
            <span className="text-yellow-600">&#9888; Upload pending...</span>
          </div>
        ))}
      {isAnalyzing && (
        <div className="mt-4">
          <Progress value={analysisProgress} className="mb-2" />
          <p className="text-sm text-text-muted">
            Analyzing... {analysisProgress}%
          </p>
        </div>
      )}

      {/* Statistics */}
      {analysisResult != null && (
        <Card className="mt-4">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Analysis Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              States: {filteredStates.length}
              {filteredStates.length !== allStatesCount && (
                <span className="text-text-muted"> (of {allStatesCount})</span>
              )}
            </div>
            <div>
              StateImages: {filteredStateImages.length}
              {filteredStateImages.length !== allStateImagesCount && (
                <span className="text-text-muted">
                  {" "}
                  (of {allStateImagesCount})
                </span>
              )}
            </div>
            <div>
              Stability Score:{" "}
              {(() => {
                const result = analysisResult as {
                  statistics?: { pixel_stability_score?: number };
                };
                return result.statistics?.pixel_stability_score
                  ? (result.statistics.pixel_stability_score * 100).toFixed(1) +
                      "%"
                  : "N/A";
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick State Selector */}
      {filteredStates && filteredStates.length > 0 ? (
        <Card className="mt-4">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">
              States ({filteredStates.length})
              {filteredStates.length !== allStatesCount && (
                <span className="text-text-muted ml-1">(filtered)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-48 overflow-y-auto">
            {filteredStates.map((state, index) => {
              return (
                <button
                  key={state?.id || index}
                  className={cn(
                    "w-full text-left px-2 py-1 rounded text-sm hover:bg-surface-raised",
                    selectedState?.id === state?.id && "bg-blue-100"
                  )}
                  onClick={() => onSelectState(state)}
                >
                  <div className="flex justify-between items-center">
                    <span className="truncate">{state?.name || "Unnamed"}</span>
                    <span className="text-xs text-text-muted">
                      {state?.stateImageIds?.length || 0}
                    </span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 text-xs text-text-muted text-center">
          No states found yet
        </div>
      )}

      {/* Pixel Filters */}
      {stateImages && stateImages.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center">
                <Filter className="h-4 w-4 mr-2" />
                Pixel Filters
              </span>
              {isFilterActive && (
                <Badge variant="secondary" className="text-xs">
                  Active
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Dark Pixels Filter */}
            <div className="space-y-2">
              <Label className="text-xs flex justify-between">
                <span>Max Dark Pixels</span>
                <span className="text-text-muted">
                  {maxDarkPixelPercentage}%
                </span>
              </Label>
              <Slider
                value={[maxDarkPixelPercentage]}
                onValueChange={([value]) =>
                  onMaxDarkPixelPercentageChange(value ?? 50)
                }
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-text-muted">
                Hide regions with more than {maxDarkPixelPercentage}% dark
                pixels
              </p>
            </div>

            {/* Light Pixels Filter */}
            <div className="space-y-2">
              <Label className="text-xs flex justify-between">
                <span>Max Light Pixels</span>
                <span className="text-text-muted">
                  {maxLightPixelPercentage}%
                </span>
              </Label>
              <Slider
                value={[maxLightPixelPercentage]}
                onValueChange={([value]) =>
                  onMaxLightPixelPercentageChange(value ?? 50)
                }
                min={0}
                max={100}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-text-muted">
                Hide regions with more than {maxLightPixelPercentage}% light
                pixels
              </p>
            </div>

            {/* Reset Button */}
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={onResetFilters}
            >
              Reset Filters
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default LeftPanel;
