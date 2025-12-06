"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Plus, X } from "lucide-react";
import { Action } from "./types";

interface SimilarityThresholdOverrideProps {
  action: Action;
  updateConfig: (key: string, value: any) => void;
}

/**
 * Reusable similarity threshold override component for FIND actions.
 */
export function SimilarityThresholdOverride({
  action,
  updateConfig,
}: SimilarityThresholdOverrideProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-gray-400">
          Similarity Threshold Override
        </Label>
        {action.config.similarity !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
            onClick={() => {
              const { similarity, ...rest } = action.config;
              updateConfig("__reset__", rest);
            }}
            title="Remove override (use project default)"
          >
            <X className="w-3 h-3" />
          </Button>
        ) : (
          <span className="text-xs text-gray-500">(using project default)</span>
        )}
      </div>
      {action.config.similarity !== undefined && (
        <>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[action.config.similarity * 100]}
            onValueChange={(values) => {
              const value = values[0];
              if (value !== undefined) {
                updateConfig("similarity", value / 100);
              }
            }}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>70%</span>
            <span className="text-gray-400">
              {(action.config.similarity * 100).toFixed(0)}%
            </span>
            <span>100%</span>
          </div>
        </>
      )}
      {action.config.similarity === undefined && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
          onClick={() => updateConfig("similarity", 0.85)}
        >
          <Plus className="w-3 h-3 mr-1" />
          Set Override
        </Button>
      )}
    </div>
  );
}
