"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Scan, RefreshCw } from "lucide-react";
import type { ProcessingOptionsState } from "../semantic-analysis-types";
import {
  getStrategyDescription,
  getDescriptionModelText,
  SAM3_PRESETS,
} from "../semantic-analysis-utils";

interface ProcessingOptionsCardProps {
  options: ProcessingOptionsState;
  selectedImage: string | null;
  processing: boolean;
  onProcessImage: () => void;
}

export function ProcessingOptionsCard({
  options,
  selectedImage,
  processing,
  onProcessImage,
}: ProcessingOptionsCardProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Processing Options</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">Detection Strategy</Label>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <Button
              size="sm"
              variant={options.strategy === "sam2" ? "default" : "outline"}
              onClick={() => options.setStrategy("sam2")}
              className="text-xs"
              title="Segment Anything Model v2 - generates pixel-perfect masks"
            >
              SAM2
            </Button>
            <Button
              size="sm"
              variant={options.strategy === "sam3" ? "default" : "outline"}
              onClick={() => options.setStrategy("sam3")}
              className="text-xs"
              title="Segment Anything Model v3 - text-prompted segmentation"
            >
              SAM3
            </Button>
            <Button
              size="sm"
              variant={options.strategy === "ocr" ? "default" : "outline"}
              onClick={() => options.setStrategy("ocr")}
              className="text-xs"
              title="Optical Character Recognition - focuses on text extraction"
            >
              OCR
            </Button>
            <Button
              size="sm"
              variant={options.strategy === "hybrid" ? "default" : "outline"}
              onClick={() => options.setStrategy("hybrid")}
              className="text-xs"
              title="Combined approach using both segmentation and text detection"
            >
              Hybrid
            </Button>
          </div>
          <p className="text-[10px] text-text-muted mt-1 leading-tight">
            {getStrategyDescription(options.strategy)}
          </p>
        </div>

        {/* SAM3 Text Prompt Controls */}
        {options.strategy === "sam3" && (
          <div className="space-y-3 p-3 border border-brand-primary/30 rounded-md bg-brand-primary/5">
            <div>
              <Label className="text-xs">Text Prompt (optional)</Label>
              <Input
                value={options.textPrompt}
                onChange={(e) => options.setTextPrompt(e.target.value)}
                placeholder="e.g., button, icon, text field..."
                className="mt-1 text-xs h-8 bg-surface-raised border-border-default focus:border-brand-primary"
              />
              <p className="text-[10px] text-text-muted mt-1 leading-tight">
                Describe what you want to detect
              </p>
            </div>

            <div>
              <Label className="text-xs mb-2 block">Quick Presets</Label>
              <div className="flex flex-wrap gap-1">
                {SAM3_PRESETS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant={
                      options.textPrompt === preset.toLowerCase()
                        ? "default"
                        : "outline"
                    }
                    onClick={() => options.setTextPrompt(preset.toLowerCase())}
                    className="text-xs h-6 px-2"
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div>
          <Label className="text-xs">Description Model</Label>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <Button
              size="sm"
              variant={
                options.descriptionModel === "clip" ? "default" : "outline"
              }
              onClick={() => options.setDescriptionModel("clip")}
              className="text-xs"
              title="AI-powered vision-language model for semantic descriptions"
            >
              CLIP
            </Button>
            <Button
              size="sm"
              variant={
                options.descriptionModel === "basic" ? "default" : "outline"
              }
              onClick={() => options.setDescriptionModel("basic")}
              className="text-xs"
              title="Rule-based detection using OpenCV computer vision"
            >
              OpenCV
            </Button>
          </div>
          <p className="text-[10px] text-text-muted mt-1 leading-tight">
            {getDescriptionModelText(options.descriptionModel)}
          </p>
        </div>

        <div>
          <Label className="text-xs">
            Min Confidence: {options.confidence.toFixed(2)}
          </Label>
          <Slider
            value={[options.confidence]}
            onValueChange={([v]) => options.setConfidence(v ?? 0)}
            min={0}
            max={1}
            step={0.05}
            className="mt-1"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs">Enable OCR</Label>
          <Switch
            checked={options.enableOCR}
            onCheckedChange={options.setEnableOCR}
          />
        </div>

        <Button
          onClick={onProcessImage}
          disabled={!selectedImage || processing}
          className="w-full bg-brand-primary hover:bg-brand-primary/80 text-black"
        >
          {processing ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Scan className="w-4 h-4 mr-2" />
              Analyze Image
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
