"use client";

import { Type, CheckCircle2, CheckCheck, Layers } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import type { ReviewStatus } from "@/stores/extraction-annotation-store";
import {
  ELEMENT_TYPES,
  REVIEW_STATUS_CONFIG,
} from "./element-annotation-form-types";

interface MultiSelectStats {
  types: string;
  groundTruthCount: number;
  totalCount: number;
}

interface MultiSelectFormProps {
  className?: string;
  selectedCount: number;
  stats: MultiSelectStats | null;
  onBulkSetType: (type: string) => void;
  onBulkSetGroundTruth: (value: boolean) => void;
  onBulkSetReviewStatus: (status: ReviewStatus) => void;
}

export function MultiSelectForm({
  className,
  selectedCount,
  stats,
  onBulkSetType,
  onBulkSetGroundTruth,
  onBulkSetReviewStatus,
}: MultiSelectFormProps) {
  return (
    <Card className={`p-4 bg-surface-raised/60 space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-[#9B59B6]" />
        <h3 className="text-sm font-semibold text-[#9B59B6]">
          {selectedCount} Elements Selected
        </h3>
      </div>

      <p className="text-xs text-text-muted">
        Edit properties in bulk. Changes apply to all selected elements.
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Type className="h-3 w-3" />
          Set Element Type
        </Label>
        <Select onValueChange={onBulkSetType}>
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

      <div className="space-y-2">
        <Label className="text-xs flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3" />
          Ground Truth
        </Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkSetGroundTruth(true)}
          >
            Mark All as Ground Truth
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onBulkSetGroundTruth(false)}
          >
            Unmark All
          </Button>
        </div>
      </div>

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
                  onClick={() => onBulkSetReviewStatus(status)}
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

      {stats && (
        <div className="pt-2 border-t border-border-subtle text-xs text-text-muted">
          <p>Types: {stats.types}</p>
          <p>
            Ground Truth: {stats.groundTruthCount} of {stats.totalCount}
          </p>
        </div>
      )}
    </Card>
  );
}
