/**
 * Background Removal Tab Component
 * Allows users to remove backgrounds from screenshots for State Discovery
 */

import React, { useState, useCallback } from "react";
import {
  Play,
  Download,
  Settings,
  Eye,
  AlertCircle,
  Loader2,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import {
  BackgroundRemovalConfig,
  BackgroundRemovalResult,
  DEFAULT_BACKGROUND_REMOVAL_CONFIG,
  BACKGROUND_REMOVAL_PRESETS,
  PresetName,
} from "@/types/backgroundRemoval";
import { useAutomation } from "@/contexts/automation-context";

export const BackgroundRemovalTab: React.FC = () => {
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<string[]>(
    []
  );
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0);
  const [config, setConfig] = useState<BackgroundRemovalConfig>(
    DEFAULT_BACKGROUND_REMOVAL_CONFIG
  );
  const [result, setResult] = useState<BackgroundRemovalResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetName>("balanced");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { screenshots: projectScreenshots } = useAutomation();

  // Get selected screenshots from project screenshots
  const selectedScreenshots = projectScreenshots.filter((s) =>
    selectedScreenshotIds.includes(s.id)
  );

  // Handle screenshot selection
  const handleScreenshotsSelected = useCallback((screenshotIds: string[]) => {
    setSelectedScreenshotIds(screenshotIds);
    setSelectedScreenshotIndex(0);
    setResult(null); // Clear previous results when selection changes
    toast.success(`Selected ${screenshotIds.length} screenshot(s)`);
  }, []);

  // Handle preset selection
  const handlePresetChange = useCallback((preset: PresetName) => {
    setActivePreset(preset);
    setConfig(BACKGROUND_REMOVAL_PRESETS[preset]);
    toast.info(`Applied preset: ${preset}`);
  }, []);

  // Handle background removal
  const handleRemoveBackground = useCallback(async () => {
    if (selectedScreenshots.length < 2) {
      toast.error("Please select at least 2 screenshots");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      console.log(
        "[BackgroundRemoval] Selected screenshots:",
        selectedScreenshots.length
      );
      console.log(
        "[BackgroundRemoval] First screenshot URL preview:",
        selectedScreenshots[0]?.url.substring(0, 100) ?? "No screenshots"
      );

      // Prepare request
      const requestBody = {
        screenshots: selectedScreenshots.map((s) => s.url),
        config: {
          use_temporal_variance: config.useTemporalVariance,
          use_edge_density: config.useEdgeDensity,
          use_uniformity: config.useUniformity,
          variance_threshold: config.varianceThreshold,
          min_screenshots_for_variance: config.minScreenshotsForVariance,
          edge_density_threshold: config.edgeDensityThreshold,
          edge_kernel_size: config.edgeKernelSize,
          uniformity_threshold: config.uniformityThreshold,
          uniformity_region_size: config.uniformityRegionSize,
          apply_morphology: config.applyMorphology,
          morphology_kernel_size: config.morphologyKernelSize,
          min_foreground_region_size: config.minForegroundRegionSize,
          foreground_alpha: config.foregroundAlpha,
          background_alpha: config.backgroundAlpha,
        },
        debug: false,
      };

      // Call API
      const response = await fetch("/api/v1/remove-background", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // Convert API response to frontend format
      const result: BackgroundRemovalResult = {
        maskedScreenshots: data.masked_screenshots,
        statistics: {
          totalPixels: data.statistics.total_pixels,
          backgroundPixels: data.statistics.background_pixels,
          foregroundPixels: data.statistics.foreground_pixels,
          backgroundPercentage: data.statistics.background_percentage,
          foregroundPercentage: data.statistics.foreground_percentage,
          numScreenshots: data.statistics.num_screenshots,
          imageSize: data.statistics.image_size,
        },
        backgroundMask: data.background_mask,
      };

      setResult(result);
      toast.success("Background removal complete!");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setError(errorMessage);
      toast.error(`Failed to remove backgrounds: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedScreenshots, config]);

  // Handle download results
  const handleDownloadResults = useCallback(() => {
    if (!result) return;

    result.maskedScreenshots.forEach((dataUrl, index) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `masked_${selectedScreenshots[index]?.name ?? "screenshot"}`;
      link.click();
    });

    toast.success("Downloaded processed screenshots");
  }, [result, selectedScreenshots]);

  const selectedScreenshot = selectedScreenshots[selectedScreenshotIndex];

  return (
    <div className="h-full flex flex-col bg-[#18181B]">
      {/* Header */}
      <div className="bg-[#1A1A1C] border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Background Removal
            </h1>
            <p className="text-gray-400 mt-1">
              Remove dynamic backgrounds from screenshots for robust State
              Discovery
            </p>
          </div>
          <Badge
            variant="outline"
            className="bg-amber-900/20 text-amber-400 border-amber-600"
          >
            Experimental
          </Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-80 bg-[#1A1A1C] border-r border-gray-700 flex flex-col overflow-hidden">
          {/* Screenshot Selection Section */}
          <div className="p-4 border-b border-gray-700">
            <h2 className="font-semibold text-white mb-3">Screenshots</h2>
            <ScreenshotSelector
              selectedScreenshot=""
              onSelectScreenshot={() => {}}
              multiSelect={true}
              selectedScreenshots={selectedScreenshotIds}
              onSelectScreenshots={handleScreenshotsSelected}
              allowUpload={true}
              trigger={
                <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white border-blue-500">
                  <Camera className="w-4 h-4 mr-2" />
                  Select Screenshots
                </Button>
              }
            />
            <p className="text-xs text-gray-400 mt-2">
              {selectedScreenshots.length} screenshot(s) selected
            </p>
          </div>

          {/* Configuration Section */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Presets */}
            <Card className="bg-[#27272A] border-gray-700">
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-white">Presets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(Object.keys(BACKGROUND_REMOVAL_PRESETS) as PresetName[]).map(
                  (preset) => (
                    <Button
                      key={preset}
                      variant={activePreset === preset ? "default" : "outline"}
                      className={`w-full justify-start ${
                        activePreset === preset
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-[#18181B] text-gray-300 border-gray-600 hover:bg-[#27272A] hover:text-white"
                      }`}
                      size="sm"
                      onClick={() => handlePresetChange(preset)}
                    >
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </Button>
                  )
                )}
              </CardContent>
            </Card>

            {/* Detection Strategies */}
            <Card className="bg-[#27272A] border-gray-700">
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm text-white">
                  Detection Strategies
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="h-6 text-xs text-gray-300 hover:text-white hover:bg-[#18181B]"
                >
                  <Settings className="w-3 h-3 mr-1" />
                  {showAdvanced ? "Simple" : "Advanced"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Temporal Variance */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">
                    Temporal Variance
                  </Label>
                  <Switch
                    checked={config.useTemporalVariance}
                    onCheckedChange={(checked) =>
                      setConfig({ ...config, useTemporalVariance: checked })
                    }
                  />
                </div>
                {showAdvanced && config.useTemporalVariance && (
                  <div className="ml-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-400">
                        Threshold: {config.varianceThreshold.toFixed(1)}
                      </Label>
                      <Slider
                        value={[config.varianceThreshold]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, varianceThreshold: value ?? 20 })
                        }
                        min={5}
                        max={50}
                        step={1}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                {/* Edge Density */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">Edge Density</Label>
                  <Switch
                    checked={config.useEdgeDensity}
                    onCheckedChange={(checked) =>
                      setConfig({ ...config, useEdgeDensity: checked })
                    }
                  />
                </div>
                {showAdvanced && config.useEdgeDensity && (
                  <div className="ml-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-400">
                        Threshold: {config.edgeDensityThreshold.toFixed(2)}
                      </Label>
                      <Slider
                        value={[config.edgeDensityThreshold * 100]}
                        onValueChange={(values) => {
                          const value = values[0];
                          if (value !== undefined) {
                            setConfig({
                              ...config,
                              edgeDensityThreshold: value / 100,
                            });
                          }
                        }}
                        min={1}
                        max={15}
                        step={0.5}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}

                {/* Uniformity */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">Uniformity</Label>
                  <Switch
                    checked={config.useUniformity}
                    onCheckedChange={(checked) =>
                      setConfig({ ...config, useUniformity: checked })
                    }
                  />
                </div>
                {showAdvanced && config.useUniformity && (
                  <div className="ml-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-400">
                        Threshold: {config.uniformityThreshold.toFixed(1)}
                      </Label>
                      <Slider
                        value={[config.uniformityThreshold]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, uniformityThreshold: value ?? 15 })
                        }
                        min={5}
                        max={30}
                        step={1}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Post-Processing */}
            {showAdvanced && (
              <Card className="bg-[#27272A] border-gray-700">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm text-white">
                    Post-Processing
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-300">Morphology</Label>
                    <Switch
                      checked={config.applyMorphology}
                      onCheckedChange={(checked) =>
                        setConfig({ ...config, applyMorphology: checked })
                      }
                    />
                  </div>
                  {config.applyMorphology && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-400">
                        Min Region Size: {config.minForegroundRegionSize}px
                      </Label>
                      <Slider
                        value={[config.minForegroundRegionSize]}
                        onValueChange={([value]) =>
                          setConfig({
                            ...config,
                            minForegroundRegionSize: value ?? 50,
                          })
                        }
                        min={10}
                        max={200}
                        step={10}
                        className="w-full"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Process Button */}
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white disabled:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleRemoveBackground}
              disabled={selectedScreenshots.length < 2 || isProcessing}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Remove Backgrounds
                </>
              )}
            </Button>
            {selectedScreenshots.length < 2 && (
              <p className="text-xs text-amber-400 mt-2">
                Select at least 2 screenshots to remove backgrounds
              </p>
            )}
          </div>
        </div>

        {/* Center Panel - Preview */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden bg-[#18181B]">
          <Tabs defaultValue="original" className="flex-1 flex flex-col">
            <TabsList className="bg-[#27272A] border-gray-700">
              <TabsTrigger
                value="original"
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-300"
              >
                Original
              </TabsTrigger>
              <TabsTrigger
                value="processed"
                disabled={!result}
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-300"
              >
                Processed
              </TabsTrigger>
              <TabsTrigger
                value="comparison"
                disabled={!result}
                className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-300"
              >
                Comparison
              </TabsTrigger>
            </TabsList>

            <TabsContent value="original" className="flex-1 mt-4">
              {selectedScreenshot ? (
                <div className="h-full flex flex-col">
                  <div className="flex gap-2 mb-2 overflow-x-auto">
                    {selectedScreenshots.map((screenshot, index) => (
                      <button
                        key={screenshot.id}
                        onClick={() => setSelectedScreenshotIndex(index)}
                        className={`px-3 py-1 rounded text-sm ${
                          index === selectedScreenshotIndex
                            ? "bg-blue-600 text-white"
                            : "bg-[#27272A] text-gray-300 hover:bg-[#3A3A3D] border border-gray-600"
                        }`}
                      >
                        {screenshot.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 border border-gray-700 rounded bg-[#27272A] overflow-auto">
                    <img
                      src={selectedScreenshot.url}
                      alt={selectedScreenshot.name}
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Camera className="w-12 h-12 mx-auto mb-2" />
                    <p>Select screenshots to preview</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="processed" className="flex-1 mt-4">
              {result ? (
                <div className="h-full flex flex-col">
                  <div
                    className="flex-1 border border-gray-700 rounded overflow-auto p-4"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #3A3A3D 25%, transparent 25%),
                        linear-gradient(-45deg, #3A3A3D 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #3A3A3D 75%),
                        linear-gradient(-45deg, transparent 75%, #3A3A3D 75%)
                      `,
                      backgroundSize: "20px 20px",
                      backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                      backgroundColor: "#27272A",
                    }}
                  >
                    <img
                      src={result.maskedScreenshots[selectedScreenshotIndex]}
                      alt="Processed"
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <p>Process screenshots to see results</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="comparison" className="flex-1 mt-4">
              {result ? (
                <div className="h-full grid grid-cols-2 gap-4">
                  <div className="border border-gray-700 rounded bg-[#27272A] overflow-auto">
                    <div className="p-2 bg-[#1A1A1C] font-semibold text-sm text-white border-b border-gray-700">
                      Original
                    </div>
                    <img
                      src={selectedScreenshot?.url}
                      alt="Original"
                      className="max-w-full h-auto"
                    />
                  </div>
                  <div
                    className="border border-gray-700 rounded overflow-auto"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #3A3A3D 25%, transparent 25%),
                        linear-gradient(-45deg, #3A3A3D 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #3A3A3D 75%),
                        linear-gradient(-45deg, transparent 75%, #3A3A3D 75%)
                      `,
                      backgroundSize: "20px 20px",
                      backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
                      backgroundColor: "#27272A",
                    }}
                  >
                    <div className="p-2 bg-[#1A1A1C] font-semibold text-sm text-white border-b border-gray-700">
                      Processed
                    </div>
                    <img
                      src={result.maskedScreenshots[selectedScreenshotIndex]}
                      alt="Processed"
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <p>Process screenshots to compare</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel - Statistics & Actions */}
        <div className="w-80 bg-[#1A1A1C] border-l border-gray-700 flex flex-col overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h2 className="font-semibold text-white">Results</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {result ? (
              <>
                {/* Statistics */}
                <Card className="bg-[#27272A] border-gray-700">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm text-white">
                      Statistics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Screenshots:</span>
                      <span className="font-medium text-white">
                        {result.statistics.numScreenshots}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Image Size:</span>
                      <span className="font-medium text-white">
                        {result.statistics.imageSize[0]}×
                        {result.statistics.imageSize[1]}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Foreground:</span>
                      <span className="font-medium text-green-400">
                        {result.statistics.foregroundPercentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Background:</span>
                      <span className="font-medium text-red-400">
                        {result.statistics.backgroundPercentage.toFixed(1)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <Card className="bg-[#27272A] border-gray-700">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm text-white">
                      Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button
                      variant="outline"
                      className="w-full bg-[#18181B] text-gray-300 border-gray-600 hover:bg-[#3A3A3D] hover:text-white"
                      onClick={handleDownloadResults}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Results
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full bg-[#18181B] text-gray-300 border-gray-600 opacity-50"
                      disabled
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Use in State Discovery
                    </Button>
                  </CardContent>
                </Card>

                {/* Info */}
                <Alert className="bg-blue-900/20 border-blue-600 text-blue-300">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Use the processed screenshots with State Discovery for more
                    accurate detection of UI elements.
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <p className="text-sm">No results yet</p>
                <p className="text-xs mt-2">
                  Process screenshots to see statistics
                </p>
              </div>
            )}

            {error && (
              <Alert
                variant="destructive"
                className="bg-red-900/20 border-red-600 text-red-300"
              >
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
