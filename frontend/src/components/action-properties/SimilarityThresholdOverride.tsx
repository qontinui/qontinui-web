"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Plus, X } from "lucide-react";
import { Action } from "./types";

interface SimilarityThresholdOverrideProps {
  action: Action;
  updateConfig: (key: string, value: unknown) => void;
}

/**
 * Reusable similarity threshold override component for FIND actions.
 */
export function SimilarityThresholdOverride({
  action,
  updateConfig,
}: SimilarityThresholdOverrideProps) {
  const similarity = (action.config as Record<string, unknown>).similarity as
    | number
    | null
    | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-muted">
          Similarity Threshold Override
        </Label>
        {similarity !== undefined && similarity !== null ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-text-muted hover:text-red-400"
            onClick={() => {
              const { similarity: _similarity, ...rest } =
                action.config as Record<string, unknown>;
              updateConfig("__reset__", rest);
            }}
            title="Remove override (use project default)"
          >
            <X className="w-3 h-3" />
          </Button>
        ) : (
          <span className="text-xs text-text-muted">
            (using project default)
          </span>
        )}
      </div>
      {similarity !== undefined && similarity !== null && (
        <>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[(similarity as number) * 100]}
            onValueChange={(values) => {
              const value = values[0];
              if (value !== undefined) {
                updateConfig("similarity", value / 100);
              }
            }}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-text-muted">
            <span>70%</span>
            <span className="text-text-muted">
              {((similarity as number) * 100).toFixed(0)}%
            </span>
            <span>100%</span>
          </div>
        </>
      )}
      {(similarity === undefined || similarity === null) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
          onClick={() => updateConfig("similarity", 0.85)}
        >
          <Plus className="w-3 h-3 mr-1" />
          Set Override
        </Button>
      )}
    </div>
  );
}
