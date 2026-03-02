"use client";

import { useState } from "react";
import { Settings, ChevronDown, ChevronRight } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import type { VisionExtractionConfig } from "@/types/extraction-unified";

interface AdvancedSettingsCardProps {
  config: VisionExtractionConfig;
  updateEdgeDetection: (
    updates: Partial<VisionExtractionConfig["edgeDetection"]>
  ) => void;
  updateSam3: (updates: Partial<VisionExtractionConfig["sam3"]>) => void;
  updateFusion: (updates: Partial<VisionExtractionConfig["fusion"]>) => void;
}

export function AdvancedSettingsCard({
  config,
  updateEdgeDetection,
  updateSam3,
  updateFusion,
}: AdvancedSettingsCardProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
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
  );
}
