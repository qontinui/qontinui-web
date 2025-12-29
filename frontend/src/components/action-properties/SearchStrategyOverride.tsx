"use client";

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { Action } from "./types";

interface SearchStrategyOverrideProps {
  action: Action;
  updateConfig: (key: string, value: unknown) => void;
}

/**
 * Reusable search strategy override component for FIND actions.
 *
 * Strategy is stored in target.searchOptions.searchStrategy (nested in searchOptions).
 */
export function SearchStrategyOverride({
  action,
  updateConfig,
}: SearchStrategyOverrideProps) {
  // Strategy is nested in target.searchOptions.searchStrategy
  const target = (action.config as Record<string, unknown>).target as Record<string, unknown> | undefined;
  const currentStrategy = target?.searchOptions?.searchStrategy as
    | string
    | undefined;

  const handleStrategyChange = (value: string) => {
    const currentTarget = target || {
      type: "image",
      imageIds: [],
    };
    const currentSearchOptions = currentTarget.searchOptions || {};

    updateConfig("target", {
      ...currentTarget,
      searchOptions: {
        ...currentSearchOptions,
        searchStrategy: value,
      },
    });
  };

  const handleRemoveStrategy = () => {
    const currentTarget = target || {
      type: "image",
      imageIds: [],
    };
    const currentSearchOptions = currentTarget.searchOptions || {};
    const { searchStrategy: _searchStrategy, ...restSearchOptions } = currentSearchOptions;

    updateConfig("target", {
      ...currentTarget,
      searchOptions:
        Object.keys(restSearchOptions).length > 0
          ? restSearchOptions
          : undefined,
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-gray-400">Search Strategy</Label>
        {currentStrategy !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-gray-500 hover:text-red-400"
            onClick={handleRemoveStrategy}
            title="Remove override (use default: FIRST)"
          >
            <X className="w-3 h-3" />
          </Button>
        ) : (
          <span className="text-xs text-gray-500">(default: FIRST)</span>
        )}
      </div>
      {currentStrategy !== undefined ? (
        <Select value={currentStrategy} onValueChange={handleStrategyChange}>
          <SelectTrigger className="bg-transparent border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#27272A] border-gray-700">
            <SelectItem value="FIRST">
              <div className="flex flex-col">
                <span>FIRST</span>
                <span className="text-xs text-gray-400">
                  Return first match found
                </span>
              </div>
            </SelectItem>
            <SelectItem value="BEST">
              <div className="flex flex-col">
                <span>BEST</span>
                <span className="text-xs text-gray-400">
                  Return highest confidence match
                </span>
              </div>
            </SelectItem>
            <SelectItem value="ALL">
              <div className="flex flex-col">
                <span>ALL</span>
                <span className="text-xs text-gray-400">
                  Return all matches found
                </span>
              </div>
            </SelectItem>
            <SelectItem value="EACH">
              <div className="flex flex-col">
                <span>EACH</span>
                <span className="text-xs text-gray-400">
                  Return one match per image
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-xs text-[#00D9FF] hover:text-[#00D9FF]/80 hover:bg-[#00D9FF]/10"
          onClick={() => handleStrategyChange("FIRST")}
        >
          <Plus className="w-3 h-3 mr-1" />
          Set Strategy
        </Button>
      )}
      {currentStrategy && (
        <p className="text-xs text-gray-500 mt-1">
          {currentStrategy === "FIRST" &&
            "Searches patterns in parallel, returns immediately on first match."}
          {currentStrategy === "BEST" &&
            "Searches all patterns in parallel, returns the highest confidence match."}
          {currentStrategy === "ALL" &&
            "Searches all patterns in parallel, returns all matches found."}
          {currentStrategy === "EACH" &&
            "Searches all patterns in parallel, returns best match per image."}
        </p>
      )}
    </div>
  );
}
