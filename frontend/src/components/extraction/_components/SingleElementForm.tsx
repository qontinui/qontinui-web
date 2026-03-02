"use client";

import {
  Tag,
  Type,
  FileText,
  Lightbulb,
  CheckCircle2,
  Box,
  MousePointer,
  Sparkles,
  CheckCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import type {
  AnnotatedElement,
  ReviewStatus,
} from "@/stores/extraction-annotation-store";
import type { UseFormRegister } from "react-hook-form";
import {
  ELEMENT_TYPES,
  REVIEW_STATUS_CONFIG,
  type FormValues,
} from "./element-annotation-form-types";

interface SingleElementFormProps {
  className?: string;
  element: AnnotatedElement;
  watchedValues: FormValues;
  register: UseFormRegister<FormValues>;
  setValue: (
    field: keyof FormValues,
    value: FormValues[keyof FormValues]
  ) => void;
}

export function SingleElementForm({
  className,
  element,
  watchedValues,
  register,
  setValue,
}: SingleElementFormProps) {
  return (
    <Card className={`p-4 bg-surface-raised/60 space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#9B59B6]">
          Element Properties
        </h3>
        <div className="flex gap-1">
          {element.isAutoDetected && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              <Sparkles className="h-3 w-3 mr-1" />
              Auto
            </Badge>
          )}
          {element.detectionTechnique && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {element.detectionTechnique}
            </Badge>
          )}
        </div>
      </div>

      <div className="p-2 rounded bg-surface-canvas/50 border border-border-subtle">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Box className="h-3 w-3" />
          <span className="font-mono">
            x:{element.bbox.x} y:{element.bbox.y} w:{element.bbox.width} h:
            {element.bbox.height}
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Tag className="h-3 w-3" />
          Label <span className="text-destructive">*</span>
        </Label>
        <Input
          {...register("label")}
          placeholder="e.g., Submit Button, Username Input"
          className="text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Type className="h-3 w-3" />
          Element Type
        </Label>
        <Select
          value={watchedValues.elementType}
          onValueChange={(value) => setValue("elementType", value)}
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ELEMENT_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <FileText className="h-3 w-3" />
          Description
        </Label>
        <Textarea
          {...register("description")}
          placeholder="Brief description of the element..."
          className="text-sm min-h-[60px] resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Lightbulb className="h-3 w-3" />
          Reasoning
        </Label>
        <Textarea
          {...register("reasoning")}
          placeholder="Why is this element important for automation?"
          className="text-sm min-h-[60px] resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <CheckCheck className="h-3 w-3" />
          Review Status
        </Label>
        <Select
          value={watchedValues.reviewStatus}
          onValueChange={(value) =>
            setValue("reviewStatus", value as ReviewStatus)
          }
        >
          <SelectTrigger className="text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(REVIEW_STATUS_CONFIG) as ReviewStatus[]).map(
              (status) => {
                const config = REVIEW_STATUS_CONFIG[status];
                return (
                  <SelectItem key={status} value={status}>
                    <div className={`flex items-center gap-2 ${config.color}`}>
                      {config.icon}
                      {config.label}
                    </div>
                  </SelectItem>
                );
              }
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 pt-2 border-t border-border-subtle">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MousePointer className="h-3 w-3 text-text-muted" />
            <Label className="text-xs">Is Clickable</Label>
          </div>
          <Switch
            checked={watchedValues.isClickable}
            onCheckedChange={(checked) => setValue("isClickable", checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-text-muted" />
            <Label className="text-xs">Ground Truth</Label>
          </div>
          <Switch
            checked={watchedValues.isGroundTruth}
            onCheckedChange={(checked) => setValue("isGroundTruth", checked)}
          />
        </div>
      </div>

      {element.confidence > 0 && (
        <div className="pt-2 border-t border-border-subtle">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Detection Confidence</span>
            <span
              className={`font-mono ${
                element.confidence >= 0.8
                  ? "text-green-500"
                  : element.confidence >= 0.5
                    ? "text-yellow-500"
                    : "text-red-500"
              }`}
            >
              {(element.confidence * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {element.text && (
        <div className="pt-2 border-t border-border-subtle">
          <Label className="text-xs text-text-muted block mb-1">
            Detected Text
          </Label>
          <p className="text-sm font-mono bg-surface-canvas/50 p-2 rounded border border-border-subtle">
            {element.text}
          </p>
        </div>
      )}
    </Card>
  );
}
