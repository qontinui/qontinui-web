/**
 * Background Removal Tab Component
 * Allows users to remove backgrounds from screenshots for State Discovery
 */

import React, { useState, useCallback } from 'react';
import { Upload, Play, Download, Settings, Eye, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import {
  BackgroundRemovalConfig,
  BackgroundRemovalResult,
  DEFAULT_BACKGROUND_REMOVAL_CONFIG,
  BACKGROUND_REMOVAL_PRESETS,
  PresetName,
} from '@/types/backgroundRemoval';
import { useAutomation } from '@/contexts/automation-context';

interface UploadedScreenshot {
  id: string;
  name: string;
  file: File;
  dataUrl: string;
}

export const BackgroundRemovalTab: React.FC = () => {
  const [screenshots, setScreenshots] = useState<UploadedScreenshot[]>([]);
  const [selectedScreenshotIndex, setSelectedScreenshotIndex] = useState(0);
  const [config, setConfig] = useState<BackgroundRemovalConfig>(DEFAULT_BACKGROUND_REMOVAL_CONFIG);
  const [result, setResult] = useState<BackgroundRemovalResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetName>('balanced');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { screenshots: projectScreenshots } = useAutomation();

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newScreenshots: UploadedScreenshot[] = [];

    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });

      newScreenshots.push({
        id: `screenshot-${Date.now()}-${Math.random()}`,
        name: file.name,
        file,
        dataUrl,
      });
    }

    setScreenshots(prev => [...prev, ...newScreenshots]);
    toast.success(`Uploaded ${files.length} screenshot(s)`);
  }, []);

  // Handle preset selection
  const handlePresetChange = useCallback((preset: PresetName) => {
    setActivePreset(preset);
    setConfig(BACKGROUND_REMOVAL_PRESETS[preset]);
    toast.info(`Applied preset: ${preset}`);
  }, []);

  // Handle background removal
  const handleRemoveBackground = useCallback(async () => {
    if (screenshots.length < 2) {
      toast.error('Please upload at least 2 screenshots');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Prepare request
      const requestBody = {
        screenshots: screenshots.map(s => s.dataUrl),
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
      const response = await fetch('/api/v1/remove-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
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
      toast.success('Background removal complete!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      toast.error(`Failed to remove backgrounds: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  }, [screenshots, config]);

  // Handle download results
  const handleDownloadResults = useCallback(() => {
    if (!result) return;

    result.maskedScreenshots.forEach((dataUrl, index) => {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `masked_${screenshots[index].name}`;
      link.click();
    });

    toast.success('Downloaded processed screenshots');
  }, [result, screenshots]);

  const selectedScreenshot = screenshots[selectedScreenshotIndex];

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Background Removal</h1>
            <p className="text-gray-600 mt-1">
              Remove dynamic backgrounds from screenshots for robust State Discovery
            </p>
          </div>
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
            Experimental
          </Badge>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Configuration */}
        <div className="w-80 bg-white border-r flex flex-col overflow-hidden">
          {/* Upload Section */}
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900 mb-3">Screenshots</h2>
            <input
              type="file"
              id="screenshot-upload"
              multiple
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <label htmlFor="screenshot-upload">
              <Button asChild className="w-full" variant="outline">
                <span>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Screenshots
                </span>
              </Button>
            </label>
            <p className="text-xs text-gray-500 mt-2">
              {screenshots.length} screenshot(s) uploaded
            </p>
          </div>

          {/* Configuration Section */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Presets */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Presets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(Object.keys(BACKGROUND_REMOVAL_PRESETS) as PresetName[]).map((preset) => (
                  <Button
                    key={preset}
                    variant={activePreset === preset ? 'default' : 'outline'}
                    className="w-full justify-start"
                    size="sm"
                    onClick={() => handlePresetChange(preset)}
                  >
                    {preset.charAt(0).toUpperCase() + preset.slice(1)}
                  </Button>
                ))}
              </CardContent>
            </Card>

            {/* Detection Strategies */}
            <Card>
              <CardHeader className="py-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Detection Strategies</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="h-6 text-xs"
                >
                  <Settings className="w-3 h-3 mr-1" />
                  {showAdvanced ? 'Simple' : 'Advanced'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Temporal Variance */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Temporal Variance</Label>
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
                      <Label className="text-xs text-gray-600">
                        Threshold: {config.varianceThreshold.toFixed(1)}
                      </Label>
                      <Slider
                        value={[config.varianceThreshold]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, varianceThreshold: value })
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
                  <Label className="text-sm">Edge Density</Label>
                  <Switch
                    checked={config.useEdgeDensity}
                    onCheckedChange={(checked) => setConfig({ ...config, useEdgeDensity: checked })}
                  />
                </div>
                {showAdvanced && config.useEdgeDensity && (
                  <div className="ml-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-600">
                        Threshold: {config.edgeDensityThreshold.toFixed(2)}
                      </Label>
                      <Slider
                        value={[config.edgeDensityThreshold * 100]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, edgeDensityThreshold: value / 100 })
                        }
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
                  <Label className="text-sm">Uniformity</Label>
                  <Switch
                    checked={config.useUniformity}
                    onCheckedChange={(checked) => setConfig({ ...config, useUniformity: checked })}
                  />
                </div>
                {showAdvanced && config.useUniformity && (
                  <div className="ml-4 space-y-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-gray-600">
                        Threshold: {config.uniformityThreshold.toFixed(1)}
                      </Label>
                      <Slider
                        value={[config.uniformityThreshold]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, uniformityThreshold: value })
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
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Post-Processing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Morphology</Label>
                    <Switch
                      checked={config.applyMorphology}
                      onCheckedChange={(checked) =>
                        setConfig({ ...config, applyMorphology: checked })
                      }
                    />
                  </div>
                  {config.applyMorphology && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-600">
                        Min Region Size: {config.minForegroundRegionSize}px
                      </Label>
                      <Slider
                        value={[config.minForegroundRegionSize]}
                        onValueChange={([value]) =>
                          setConfig({ ...config, minForegroundRegionSize: value })
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
              className="w-full"
              onClick={handleRemoveBackground}
              disabled={screenshots.length < 2 || isProcessing}
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
          </div>
        </div>

        {/* Center Panel - Preview */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          <Tabs defaultValue="original" className="flex-1 flex flex-col">
            <TabsList>
              <TabsTrigger value="original">Original</TabsTrigger>
              <TabsTrigger value="processed" disabled={!result}>
                Processed
              </TabsTrigger>
              <TabsTrigger value="comparison" disabled={!result}>
                Comparison
              </TabsTrigger>
            </TabsList>

            <TabsContent value="original" className="flex-1 mt-4">
              {selectedScreenshot ? (
                <div className="h-full flex flex-col">
                  <div className="flex gap-2 mb-2 overflow-x-auto">
                    {screenshots.map((screenshot, index) => (
                      <button
                        key={screenshot.id}
                        onClick={() => setSelectedScreenshotIndex(index)}
                        className={`px-3 py-1 rounded text-sm ${
                          index === selectedScreenshotIndex
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        {screenshot.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 border rounded bg-white overflow-auto">
                    <img
                      src={selectedScreenshot.dataUrl}
                      alt={selectedScreenshot.name}
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <Upload className="w-12 h-12 mx-auto mb-2" />
                    <p>Upload screenshots to preview</p>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="processed" className="flex-1 mt-4">
              {result ? (
                <div className="h-full flex flex-col">
                  <div className="flex-1 border rounded bg-gray-100 overflow-auto p-4"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                        linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                        linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
                      `,
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
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
                <div className="h-full flex items-center justify-center text-gray-400">
                  <p>Process screenshots to see results</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="comparison" className="flex-1 mt-4">
              {result ? (
                <div className="h-full grid grid-cols-2 gap-4">
                  <div className="border rounded bg-white overflow-auto">
                    <div className="p-2 bg-gray-100 font-semibold text-sm">Original</div>
                    <img
                      src={selectedScreenshot?.dataUrl}
                      alt="Original"
                      className="max-w-full h-auto"
                    />
                  </div>
                  <div className="border rounded overflow-auto"
                    style={{
                      backgroundImage: `
                        linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
                        linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
                        linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
                        linear-gradient(-45deg, transparent 75%, #f0f0f0 75%)
                      `,
                      backgroundSize: '20px 20px',
                      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
                    }}
                  >
                    <div className="p-2 bg-gray-100 font-semibold text-sm">Processed</div>
                    <img
                      src={result.maskedScreenshots[selectedScreenshotIndex]}
                      alt="Processed"
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <p>Process screenshots to compare</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right Panel - Statistics & Actions */}
        <div className="w-80 bg-white border-l flex flex-col overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold text-gray-900">Results</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {result ? (
              <>
                {/* Statistics */}
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Statistics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Screenshots:</span>
                      <span className="font-medium">{result.statistics.numScreenshots}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Image Size:</span>
                      <span className="font-medium">
                        {result.statistics.imageSize[0]}×{result.statistics.imageSize[1]}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Foreground:</span>
                      <span className="font-medium text-green-600">
                        {result.statistics.foregroundPercentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Background:</span>
                      <span className="font-medium text-red-600">
                        {result.statistics.backgroundPercentage.toFixed(1)}%
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Actions */}
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full" onClick={handleDownloadResults}>
                      <Download className="w-4 h-4 mr-2" />
                      Download Results
                    </Button>
                    <Button variant="outline" className="w-full" disabled>
                      <Eye className="w-4 h-4 mr-2" />
                      Use in State Discovery
                    </Button>
                  </CardContent>
                </Card>

                {/* Info */}
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Use the processed screenshots with State Discovery for more accurate detection of UI
                    elements.
                  </AlertDescription>
                </Alert>
              </>
            ) : (
              <div className="text-center text-gray-400 py-12">
                <p className="text-sm">No results yet</p>
                <p className="text-xs mt-2">Process screenshots to see statistics</p>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
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
