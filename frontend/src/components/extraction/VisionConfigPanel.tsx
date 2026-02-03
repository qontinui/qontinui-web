/**
 * Vision Extraction Configuration Panel
 *
 * Configuration form for vision-based GUI element extraction:
 * - Source selection (upload, monitor capture, window capture)
 * - Edge detection settings (Canny thresholds, contour filtering)
 * - SAM3 segmentation settings (model type, detection density)
 * - OCR settings (engine, confidence, languages)
 * - Result fusion settings (IoU threshold, max candidates)
 */

"use client";

import { useState } from "react";
import {
  Eye,
  Upload,
  Monitor,
  AppWindow,
  Scan,
  Type,
  Layers,
  Settings,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type {
  VisionExtractionConfig,
  VisionExtractionSource,
  OcrEngine,
  Sam3ModelType,
} from "@/types/extraction-unified";

interface VisionConfigPanelProps {
  config: VisionExtractionConfig;
  onConfigChange: (config: VisionExtractionConfig) => void;
}

const SOURCE_OPTIONS: {
  id: VisionExtractionSource;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    id: "upload",
    label: "Upload Screenshot",
    icon: <Upload className="h-4 w-4" />,
    description: "Upload an image file",
  },
  {
    id: "monitor",
    label: "Capture Monitor",
    icon: <Monitor className="h-4 w-4" />,
    description: "Capture from a monitor",
  },
  {
    id: "window",
    label: "Capture Window",
    icon: <AppWindow className="h-4 w-4" />,
    description: "Capture a specific window",
  },
];

const SAM3_MODEL_INFO: Record<Sam3ModelType, { size: string; speed: string }> = {
  vit_h: { size: "~2.5GB", speed: "Slowest, most accurate" },
  vit_l: { size: "~1.2GB", speed: "Balanced" },
  vit_b: { size: "~375MB", speed: "Fastest, less accurate" },
};

export function VisionConfigPanel({
  config,
  onConfigChange,
}: VisionConfigPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const updateConfig = (updates: Partial<VisionExtractionConfig>) => {
    onConfigChange({ ...config, ...updates });
  };

  const updateEdgeDetection = (
    updates: Partial<VisionExtractionConfig["edgeDetection"]>
  ) => {
    onConfigChange({
      ...config,
      edgeDetection: { ...config.edgeDetection, ...updates },
    });
  };

  const updateSam3 = (updates: Partial<VisionExtractionConfig["sam3"]>) => {
    onConfigChange({
      ...config,
      sam3: { ...config.sam3, ...updates },
    });
  };

  const updateOcr = (updates: Partial<VisionExtractionConfig["ocr"]>) => {
    onConfigChange({
      ...config,
      ocr: { ...config.ocr, ...updates },
    });
  };

  const updateFusion = (updates: Partial<VisionExtractionConfig["fusion"]>) => {
    onConfigChange({
      ...config,
      fusion: { ...config.fusion, ...updates },
    });
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Source Selection */}
        <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/20">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="h-5 w-5 text-[#9B59B6]" />
            <Label className="text-[#9B59B6] font-mono uppercase tracking-wider">
              Screenshot Source
            </Label>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => updateConfig({ source: option.id })}
                className={`p-3 rounded-lg border-2 transition-all text-left ${
                  config.source === option.id
                    ? "border-[#9B59B6] bg-[#9B59B6]/10"
                    : "border-border-subtle hover:border-border-default bg-surface-canvas/50"
                }`}
              >
                <div
                  className={`mb-2 ${
                    config.source === option.id
                      ? "text-[#9B59B6]"
                      : "text-text-muted"
                  }`}
                >
                  {option.icon}
                </div>
                <div
                  className={`text-sm font-medium ${
                    config.source === option.id
                      ? "text-[#9B59B6]"
                      : "text-text-primary"
                  }`}
                >
                  {option.label}
                </div>
                <div className="text-xs text-text-muted">{option.description}</div>
              </button>
            ))}
          </div>

          {/* Source-specific inputs */}
          {config.source === "upload" && (
            <div className="space-y-2">
              <Label className="text-sm text-text-muted">Screenshot Path</Label>
              <Input
                data-ui-id="extraction-vision-screenshot-path-input"
                value={config.screenshotPath || ""}
                onChange={(e) => updateConfig({ screenshotPath: e.target.value })}
                placeholder="C:\path\to\screenshot.png"
                className="font-mono text-sm"
              />
            </div>
          )}

          {config.source === "window" && (
            <div className="space-y-2">
              <Label className="text-sm text-text-muted">Window Title</Label>
              <Input
                data-ui-id="extraction-vision-window-title-input"
                value={config.windowTitle || ""}
                onChange={(e) => updateConfig({ windowTitle: e.target.value })}
                placeholder="e.g., Notepad, Calculator"
                className="font-mono text-sm"
              />
            </div>
          )}

          {config.source === "monitor" && (
            <div className="space-y-2">
              <Label className="text-sm text-text-muted">Monitor Index</Label>
              <Input
                type="number"
                data-ui-id="extraction-vision-monitor-index-input"
                value={config.monitorIndex ?? 0}
                onChange={(e) =>
                  updateConfig({ monitorIndex: parseInt(e.target.value) || 0 })
                }
                min={0}
                className="font-mono text-sm w-24"
              />
            </div>
          )}
        </Card>

        {/* Detection Methods */}
        <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/20">
          <div className="flex items-center gap-2 mb-4">
            <Scan className="h-5 w-5 text-[#9B59B6]" />
            <Label className="text-[#9B59B6] font-mono uppercase tracking-wider">
              Detection Methods
            </Label>
          </div>

          <div className="space-y-4">
            {/* Edge Detection */}
            <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-text-muted" />
                  <Label className="text-sm font-medium">Edge Detection</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-text-muted" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>
                        Uses Canny edge detection and contour analysis to find
                        rectangular UI elements like buttons and input fields.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  data-ui-id="extraction-vision-edge-toggle"
                  checked={config.edgeDetection.enabled}
                  onCheckedChange={(checked) =>
                    updateEdgeDetection({ enabled: checked })
                  }
                />
              </div>
              {config.edgeDetection.enabled && (
                <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
                  <div>
                    <Label className="text-text-muted mb-1 block">
                      Canny Low: {config.edgeDetection.cannyLow}
                    </Label>
                    <Slider
                      value={[config.edgeDetection.cannyLow]}
                      onValueChange={([value]) =>
                        updateEdgeDetection({ cannyLow: value })
                      }
                      min={10}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <Label className="text-text-muted mb-1 block">
                      Canny High: {config.edgeDetection.cannyHigh}
                    </Label>
                    <Slider
                      value={[config.edgeDetection.cannyHigh]}
                      onValueChange={([value]) =>
                        updateEdgeDetection({ cannyHigh: value })
                      }
                      min={100}
                      max={300}
                      step={10}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* SAM3 Segmentation */}
            <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-text-muted" />
                  <Label className="text-sm font-medium">SAM3 Segmentation</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-text-muted" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>
                        Uses Segment Anything Model 3 for precise object
                        segmentation. Requires model download (~375MB-2.5GB).
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  data-ui-id="extraction-vision-sam3-toggle"
                  checked={config.sam3.enabled}
                  onCheckedChange={(checked) => updateSam3({ enabled: checked })}
                />
              </div>
              {config.sam3.enabled && (
                <div className="space-y-3 mt-3">
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      Model Type
                    </Label>
                    <Select
                      value={config.sam3.modelType}
                      onValueChange={(value: Sam3ModelType) =>
                        updateSam3({ modelType: value })
                      }
                    >
                      <SelectTrigger
                        data-ui-id="extraction-vision-sam3-model-select"
                        className="h-8 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="vit_b">ViT-B (Fast)</SelectItem>
                        <SelectItem value="vit_l">ViT-L (Balanced)</SelectItem>
                        <SelectItem value="vit_h">ViT-H (Accurate)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-text-muted mt-1">
                      {SAM3_MODEL_INFO[config.sam3.modelType].size} -{" "}
                      {SAM3_MODEL_INFO[config.sam3.modelType].speed}
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      Points Per Side: {config.sam3.pointsPerSide}
                    </Label>
                    <Slider
                      value={[config.sam3.pointsPerSide]}
                      onValueChange={([value]) =>
                        updateSam3({ pointsPerSide: value })
                      }
                      min={8}
                      max={64}
                      step={8}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* OCR Detection */}
            <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Type className="h-4 w-4 text-text-muted" />
                  <Label className="text-sm font-medium">OCR Detection</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-text-muted" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>
                        Detects text regions and classifies them as buttons,
                        links, or labels based on content patterns.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Switch
                  data-ui-id="extraction-vision-ocr-toggle"
                  checked={config.ocr.enabled}
                  onCheckedChange={(checked) => updateOcr({ enabled: checked })}
                />
              </div>
              {config.ocr.enabled && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      OCR Engine
                    </Label>
                    <Select
                      value={config.ocr.engine}
                      onValueChange={(value: OcrEngine) =>
                        updateOcr({ engine: value })
                      }
                    >
                      <SelectTrigger
                        data-ui-id="extraction-vision-ocr-engine-select"
                        className="h-8 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easyocr">EasyOCR (GPU)</SelectItem>
                        <SelectItem value="tesseract">Tesseract (CPU)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      Min Confidence: {(config.ocr.minConfidence * 100).toFixed(0)}%
                    </Label>
                    <Slider
                      value={[config.ocr.minConfidence]}
                      onValueChange={([value]) =>
                        updateOcr({ minConfidence: value })
                      }
                      min={0.3}
                      max={0.95}
                      step={0.05}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Advanced Settings (Collapsible) */}
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/20">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                className="w-full flex items-center justify-between p-0 h-auto hover:bg-transparent"
              >
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-[#9B59B6]" />
                  <Label className="text-[#9B59B6] font-mono uppercase tracking-wider cursor-pointer">
                    Advanced Settings
                  </Label>
                </div>
                {advancedOpen ? (
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                )}
              </Button>
            </CollapsibleTrigger>

            <CollapsibleContent className="mt-4 space-y-4">
              {/* Edge Detection Advanced */}
              {config.edgeDetection.enabled && (
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
                  <Label className="text-xs text-text-muted block mb-3">
                    Edge Detection - Contour Filtering
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-text-muted mb-1 block">
                        Min Area: {config.edgeDetection.minContourArea}px
                      </Label>
                      <Slider
                        value={[config.edgeDetection.minContourArea]}
                        onValueChange={([value]) =>
                          updateEdgeDetection({ minContourArea: value })
                        }
                        min={50}
                        max={500}
                        step={25}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-text-muted mb-1 block">
                        Max Area: {config.edgeDetection.maxContourArea}px
                      </Label>
                      <Slider
                        value={[config.edgeDetection.maxContourArea]}
                        onValueChange={([value]) =>
                          updateEdgeDetection({ maxContourArea: value })
                        }
                        min={100000}
                        max={1000000}
                        step={50000}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* SAM3 Advanced */}
              {config.sam3.enabled && (
                <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
                  <Label className="text-xs text-text-muted block mb-3">
                    SAM3 - Quality Thresholds
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-text-muted mb-1 block">
                        IoU Threshold: {config.sam3.predIouThreshold.toFixed(2)}
                      </Label>
                      <Slider
                        value={[config.sam3.predIouThreshold]}
                        onValueChange={([value]) =>
                          updateSam3({ predIouThreshold: value })
                        }
                        min={0.7}
                        max={0.98}
                        step={0.02}
                        className="w-full"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-text-muted mb-1 block">
                        Stability: {config.sam3.stabilityScoreThreshold.toFixed(2)}
                      </Label>
                      <Slider
                        value={[config.sam3.stabilityScoreThreshold]}
                        onValueChange={([value]) =>
                          updateSam3({ stabilityScoreThreshold: value })
                        }
                        min={0.8}
                        max={0.99}
                        step={0.01}
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Fusion Settings */}
              <div className="p-3 rounded-lg border border-border-subtle bg-surface-canvas/50">
                <Label className="text-xs text-text-muted block mb-3">
                  Result Fusion
                </Label>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      IoU Threshold (deduplication):{" "}
                      {config.fusion.iouThreshold.toFixed(2)}
                    </Label>
                    <Slider
                      value={[config.fusion.iouThreshold]}
                      onValueChange={([value]) =>
                        updateFusion({ iouThreshold: value })
                      }
                      min={0.3}
                      max={0.8}
                      step={0.05}
                      className="w-full"
                    />
                    <p className="text-[10px] text-text-muted mt-1">
                      Elements with IoU above this threshold are merged
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs text-text-muted mb-1 block">
                      Max Candidates: {config.fusion.maxCandidates}
                    </Label>
                    <Slider
                      value={[config.fusion.maxCandidates]}
                      onValueChange={([value]) =>
                        updateFusion({ maxCandidates: value })
                      }
                      min={100}
                      max={1000}
                      step={50}
                      className="w-full"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-text-muted">
                      Prefer Higher Confidence
                    </Label>
                    <Switch
                      checked={config.fusion.preferHigherConfidence}
                      onCheckedChange={(checked) =>
                        updateFusion({ preferHigherConfidence: checked })
                      }
                    />
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Info Alert */}
        <Alert className="bg-[#9B59B6]/5 border-[#9B59B6]/20">
          <Info className="h-4 w-4 text-[#9B59B6]" />
          <AlertDescription className="text-sm text-text-muted">
            Vision extraction detects GUI elements from screenshots using computer
            vision algorithms. Best for non-web applications where DOM-based
            extraction is not available.
            {config.sam3.enabled && (
              <span className="block mt-1">
                SAM3 requires model download on first use and a CUDA-capable GPU for
                reasonable performance.
              </span>
            )}
          </AlertDescription>
        </Alert>
      </div>
    </TooltipProvider>
  );
}
