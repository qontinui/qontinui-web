/**
 * Element Annotation Form Component
 *
 * Form for editing properties of selected element(s):
 * - Label (required)
 * - Element type dropdown
 * - Description (optional)
 * - Reasoning (why this element matters)
 * - Ground truth checkbox
 * - Review status
 * - Bounding box display
 *
 * Supports multi-selection with bulk editing.
 */

"use client";

import { useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
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
  XCircle,
  Clock,
  AlertCircle,
  Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import {
  useExtractionAnnotationStore,
  type ReviewStatus,
} from "@/stores/extraction-annotation-store";

const ELEMENT_TYPES = [
  { value: "button", label: "Button" },
  { value: "input", label: "Input Field" },
  { value: "link", label: "Link" },
  { value: "icon", label: "Icon" },
  { value: "label", label: "Label/Text" },
  { value: "container", label: "Container" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio Button" },
  { value: "dropdown", label: "Dropdown" },
  { value: "menu", label: "Menu" },
  { value: "tab", label: "Tab" },
  { value: "image", label: "Image" },
  { value: "other", label: "Other" },
];

const REVIEW_STATUS_CONFIG: Record<
  ReviewStatus,
  { label: string; icon: React.ReactNode; color: string }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="h-3 w-3" />,
    color: "text-yellow-500",
  },
  approved: {
    label: "Approved",
    icon: <CheckCheck className="h-3 w-3" />,
    color: "text-green-500",
  },
  rejected: {
    label: "Rejected",
    icon: <XCircle className="h-3 w-3" />,
    color: "text-red-500",
  },
  needs_revision: {
    label: "Needs Revision",
    icon: <AlertCircle className="h-3 w-3" />,
    color: "text-purple-500",
  },
};

interface FormValues {
  label: string;
  elementType: string;
  description: string;
  reasoning: string;
  isGroundTruth: boolean;
  isClickable: boolean;
  reviewStatus: ReviewStatus;
}

interface ElementAnnotationFormProps {
  className?: string;
}

export function ElementAnnotationForm({ className }: ElementAnnotationFormProps) {
  const selectedElementIds = useExtractionAnnotationStore(
    (state) => state.selectedElementIds
  );
  const elements = useExtractionAnnotationStore((state) => state.elements);
  const updateElement = useExtractionAnnotationStore(
    (state) => state.updateElement
  );
  const updateElements = useExtractionAnnotationStore(
    (state) => state.updateElements
  );
  const setReviewStatus = useExtractionAnnotationStore(
    (state) => state.setReviewStatus
  );

  // Memoize selected elements computation
  const selectedElements = useMemo(
    () => elements.filter((el) => selectedElementIds.includes(el.id)),
    [elements, selectedElementIds]
  );

  // Memoize derived values
  const selectedElement = useMemo(
    () => (selectedElements.length === 1 ? selectedElements[0] : null),
    [selectedElements]
  );
  const isMultiSelect = selectedElements.length > 1;

  const { register, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      label: "",
      elementType: "button",
      description: "",
      reasoning: "",
      isGroundTruth: false,
      isClickable: true,
      reviewStatus: "pending",
    },
  });

  // Update form when selected element changes
  useEffect(() => {
    if (selectedElement) {
      reset({
        label: selectedElement.label || "",
        elementType: selectedElement.elementType || "button",
        description: selectedElement.description || "",
        reasoning: selectedElement.reasoning || "",
        isGroundTruth: selectedElement.isGroundTruth || false,
        isClickable: selectedElement.isClickable ?? true,
        reviewStatus: selectedElement.reviewStatus || "pending",
      });
    }
  }, [selectedElement, reset]);

  // Auto-save on change (single selection only)
  const watchedValues = watch();

  useEffect(() => {
    if (!selectedElement || isMultiSelect) {
      return;
    }

    const timeout = setTimeout(() => {
      updateElement(selectedElement.id, {
        label: watchedValues.label,
        elementType: watchedValues.elementType,
        description: watchedValues.description || undefined,
        reasoning: watchedValues.reasoning || undefined,
        isGroundTruth: watchedValues.isGroundTruth,
        isClickable: watchedValues.isClickable,
        reviewStatus: watchedValues.reviewStatus,
      });
    }, 300); // Debounce

    return () => clearTimeout(timeout);
  }, [
    watchedValues.label,
    watchedValues.elementType,
    watchedValues.description,
    watchedValues.reasoning,
    watchedValues.isGroundTruth,
    watchedValues.isClickable,
    watchedValues.reviewStatus,
    selectedElement,
    isMultiSelect,
    updateElement,
  ]);

  // Memoized bulk action handlers
  const handleBulkSetGroundTruth = useCallback(
    (value: boolean) => {
      updateElements(selectedElementIds, { isGroundTruth: value });
    },
    [updateElements, selectedElementIds]
  );

  const handleBulkSetReviewStatus = useCallback(
    (status: ReviewStatus) => {
      setReviewStatus(selectedElementIds, status);
    },
    [setReviewStatus, selectedElementIds]
  );

  const handleBulkSetType = useCallback(
    (type: string) => {
      updateElements(selectedElementIds, { elementType: type });
    },
    [updateElements, selectedElementIds]
  );

  // Memoize statistics for multi-select view
  const multiSelectStats = useMemo(() => {
    if (!isMultiSelect) return null;
    return {
      types: Array.from(new Set(selectedElements.map((e) => e.elementType))).join(
        ", "
      ),
      groundTruthCount: selectedElements.filter((e) => e.isGroundTruth).length,
      totalCount: selectedElements.length,
    };
  }, [isMultiSelect, selectedElements]);

  if (selectedElements.length === 0) {
    return (
      <Card className={`p-6 bg-surface-raised/60 ${className}`}>
        <div className="flex flex-col items-center justify-center py-8 text-center text-text-muted">
          <MousePointer className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-sm">Select an element to edit its properties</p>
          <p className="text-xs mt-2 opacity-60">
            Use the Select tool and click on an element
          </p>
          <p className="text-xs mt-1 opacity-60">
            Hold Shift to select multiple elements
          </p>
        </div>
      </Card>
    );
  }

  // Multi-selection view
  if (isMultiSelect) {
    return (
      <Card className={`p-4 bg-surface-raised/60 space-y-4 ${className}`}>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[#9B59B6]" />
          <h3 className="text-sm font-semibold text-[#9B59B6]">
            {selectedElements.length} Elements Selected
          </h3>
        </div>

        <p className="text-xs text-text-muted">
          Edit properties in bulk. Changes apply to all selected elements.
        </p>

        {/* Bulk Element Type */}
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <Type className="h-3 w-3" />
            Set Element Type
          </Label>
          <Select onValueChange={handleBulkSetType}>
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Choose type for all..." />
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

        {/* Bulk Ground Truth */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            Ground Truth
          </Label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBulkSetGroundTruth(true)}
            >
              Mark All as Ground Truth
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBulkSetGroundTruth(false)}
            >
              Unmark All
            </Button>
          </div>
        </div>

        {/* Bulk Review Status */}
        <div className="space-y-2">
          <Label className="text-xs flex items-center gap-1.5">
            <CheckCheck className="h-3 w-3" />
            Review Status
          </Label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(REVIEW_STATUS_CONFIG) as ReviewStatus[]).map(
              (status) => {
                const config = REVIEW_STATUS_CONFIG[status];
                return (
                  <Button
                    key={status}
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkSetReviewStatus(status)}
                    className={`justify-start ${config.color}`}
                  >
                    {config.icon}
                    <span className="ml-1">{config.label}</span>
                  </Button>
                );
              }
            )}
          </div>
        </div>

        {/* Summary */}
        {multiSelectStats && (
          <div className="pt-2 border-t border-border-subtle text-xs text-text-muted">
            <p>Types: {multiSelectStats.types}</p>
            <p>
              Ground Truth: {multiSelectStats.groundTruthCount} of{" "}
              {multiSelectStats.totalCount}
            </p>
          </div>
        )}
      </Card>
    );
  }

  // Single selection view
  return (
    <Card className={`p-4 bg-surface-raised/60 space-y-4 ${className}`}>
      {/* Header with badges */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#9B59B6]">Element Properties</h3>
        <div className="flex gap-1">
          {selectedElement?.isAutoDetected && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              <Sparkles className="h-3 w-3 mr-1" />
              Auto
            </Badge>
          )}
          {selectedElement?.detectionTechnique && (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {selectedElement.detectionTechnique}
            </Badge>
          )}
        </div>
      </div>

      {/* Bounding Box Info */}
      {selectedElement && (
        <div className="p-2 rounded bg-surface-canvas/50 border border-border-subtle">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Box className="h-3 w-3" />
            <span className="font-mono">
              x:{selectedElement.bbox.x} y:{selectedElement.bbox.y} w:
              {selectedElement.bbox.width} h:{selectedElement.bbox.height}
            </span>
          </div>
        </div>
      )}

      {/* Label */}
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

      {/* Element Type */}
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

      {/* Description */}
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

      {/* Reasoning */}
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

      {/* Review Status */}
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <CheckCheck className="h-3 w-3" />
          Review Status
        </Label>
        <Select
          value={watchedValues.reviewStatus}
          onValueChange={(value) => setValue("reviewStatus", value as ReviewStatus)}
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

      {/* Toggles */}
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

      {/* Confidence */}
      {selectedElement && selectedElement.confidence > 0 && (
        <div className="pt-2 border-t border-border-subtle">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Detection Confidence</span>
            <span
              className={`font-mono ${
                selectedElement.confidence >= 0.8
                  ? "text-green-500"
                  : selectedElement.confidence >= 0.5
                    ? "text-yellow-500"
                    : "text-red-500"
              }`}
            >
              {(selectedElement.confidence * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      {/* Text content if present */}
      {selectedElement?.text && (
        <div className="pt-2 border-t border-border-subtle">
          <Label className="text-xs text-text-muted block mb-1">
            Detected Text
          </Label>
          <p className="text-sm font-mono bg-surface-canvas/50 p-2 rounded border border-border-subtle">
            {selectedElement.text}
          </p>
        </div>
      )}
    </Card>
  );
}
