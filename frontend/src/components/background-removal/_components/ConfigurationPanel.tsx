import React from "react";
import { Play, Settings, Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScreenshotSelector } from "@/components/screenshot-selector";
import {
  BackgroundRemovalConfig,
  BACKGROUND_REMOVAL_PRESETS,
  PresetName,
} from "@/types/backgroundRemoval";

interface ConfigurationPanelProps {
  selectedScreenshotIds: string[];
  selectedScreenshotCount: number;
  config: BackgroundRemovalConfig;
  setConfig: React.Dispatch<React.SetStateAction<BackgroundRemovalConfig>>;
  activePreset: PresetName;
  showAdvanced: boolean;
  setShowAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  isProcessing: boolean;
  onScreenshotsSelected: (screenshotIds: string[]) => void;
  onPresetChange: (preset: PresetName) => void;
  onRemoveBackground: () => void;
}

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({
  selectedScreenshotIds,
  selectedScreenshotCount,
  config,
  setConfig,
  activePreset,
  showAdvanced,
  setShowAdvanced,
  isProcessing,
  onScreenshotsSelected,
  onPresetChange,
  onRemoveBackground,
}) => {
  return (
    <div className="w-80 bg-surface-raised border-r border-border-default flex flex-col overflow-hidden">
      {/* Screenshot Selection Section */}
      <div className="p-4 border-b border-border-default">
        <h2 className="font-semibold text-white mb-3">Screenshots</h2>
        <ScreenshotSelector
          selectedScreenshot=""
          onSelectScreenshot={() => {}}
          multiSelect={true}
          selectedScreenshots={selectedScreenshotIds}
          onSelectScreenshots={onScreenshotsSelected}
          allowUpload={true}
          trigger={
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white border-blue-500">
              <Camera className="w-4 h-4 mr-2" />
              Select Screenshots
            </Button>
          }
        />
        <p className="text-xs text-text-muted mt-2">
          {selectedScreenshotCount} screenshot(s) selected
        </p>
      </div>

      {/* Configuration Section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Presets */}
        <Card className="bg-surface-raised border-border-default">
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
                      : "bg-surface-canvas text-text-secondary border-border-default hover:bg-surface-raised hover:text-white"
                  }`}
                  size="sm"
                  onClick={() => onPresetChange(preset)}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </Button>
              )
            )}
          </CardContent>
        </Card>

        {/* Detection Strategies */}
        <Card className="bg-surface-raised border-border-default">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm text-white">
              Detection Strategies
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="h-6 text-xs text-text-secondary hover:text-white hover:bg-surface-canvas"
            >
              <Settings className="w-3 h-3 mr-1" />
              {showAdvanced ? "Simple" : "Advanced"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Temporal Variance */}
            <div className="flex items-center justify-between">
              <Label className="text-sm text-text-muted">
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
                  <Label className="text-xs text-text-muted">
                    Threshold: {config.varianceThreshold.toFixed(1)}
                  </Label>
                  <Slider
                    value={[config.varianceThreshold]}
                    onValueChange={([value]) =>
                      setConfig({
                        ...config,
                        varianceThreshold: value ?? 20,
                      })
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
              <Label className="text-sm text-text-muted">Edge Density</Label>
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
                  <Label className="text-xs text-text-muted">
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
              <Label className="text-sm text-text-muted">Uniformity</Label>
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
                  <Label className="text-xs text-text-muted">
                    Threshold: {config.uniformityThreshold.toFixed(1)}
                  </Label>
                  <Slider
                    value={[config.uniformityThreshold]}
                    onValueChange={([value]) =>
                      setConfig({
                        ...config,
                        uniformityThreshold: value ?? 15,
                      })
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
          <Card className="bg-surface-raised border-border-default">
            <CardHeader className="py-3">
              <CardTitle className="text-sm text-white">
                Post-Processing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-text-muted">Morphology</Label>
                <Switch
                  checked={config.applyMorphology}
                  onCheckedChange={(checked) =>
                    setConfig({ ...config, applyMorphology: checked })
                  }
                />
              </div>
              {config.applyMorphology && (
                <div className="space-y-2">
                  <Label className="text-xs text-text-muted">
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
          className="w-full bg-green-600 hover:bg-green-700 text-white disabled:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onRemoveBackground}
          disabled={selectedScreenshotCount < 2 || isProcessing}
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
        {selectedScreenshotCount < 2 && (
          <p className="text-xs text-amber-400 mt-2">
            Select at least 2 screenshots to remove backgrounds
          </p>
        )}
      </div>
    </div>
  );
};
