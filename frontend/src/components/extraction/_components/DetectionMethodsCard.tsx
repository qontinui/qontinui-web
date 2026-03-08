"use client";

import { Scan, Layers, Type, Info } from "lucide-react";
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
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import type {
  VisionExtractionConfig,
  OcrEngine,
  Sam3ModelType,
} from "@/types/extraction-unified";

const SAM3_MODEL_INFO: Record<Sam3ModelType, { size: string; speed: string }> =
  {
    vit_h: { size: "~2.5GB", speed: "Slowest, most accurate" },
    vit_l: { size: "~1.2GB", speed: "Balanced" },
    vit_b: { size: "~375MB", speed: "Fastest, less accurate" },
  };

interface DetectionMethodsCardProps {
  config: VisionExtractionConfig;
  updateEdgeDetection: (
    updates: Partial<VisionExtractionConfig["edgeDetection"]>
  ) => void;
  updateSam3: (updates: Partial<VisionExtractionConfig["sam3"]>) => void;
  updateOcr: (updates: Partial<VisionExtractionConfig["ocr"]>) => void;
}

export function DetectionMethodsCard({
  config,
  updateEdgeDetection,
  updateSam3,
  updateOcr,
}: DetectionMethodsCardProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/20">
      <div className="flex items-center gap-2 mb-4">
        <Scan className="h-5 w-5 text-[#9B59B6]" />
        <Label className="text-[#9B59B6] font-mono uppercase tracking-wider">
          Detection Methods
        </Label>
      </div>

      <div className="space-y-4">
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
                  <SelectTrigger className="h-8 text-xs">
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
                    Detects text regions and classifies them as buttons, links,
                    or labels based on content patterns.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
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
                  <SelectTrigger className="h-8 text-xs">
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
  );
}
