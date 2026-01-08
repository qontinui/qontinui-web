"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { SimilarityThresholdOverride } from "../SimilarityThresholdOverride";
import type { State, StateImage } from "@/stores/automation";

/**
 * Properties component for RAG_FIND action.
 *
 * RAG Find uses vector embeddings (CLIP) for fast, semantic element matching.
 * It requires RAG setup to have been run on the project.
 */
export function RagFindActionProperties({
  action,
  updateConfig,
  states,
}: ActionPropertiesComponentProps) {
  const typedStates = states as State[];

  // Extract all StateImages from all states for selection
  const allStateImages: Array<{ stateImage: StateImage; state: State }> = [];
  typedStates.forEach((state) => {
    state.stateImages?.forEach((si) => {
      allStateImages.push({ stateImage: si, state });
    });
  });

  const target = action.config.target as
    | { type?: string; stateImageId?: string }
    | undefined;
  const selectedStateImageId = target?.stateImageId || "";
  const multiPatternMode = action.config.multiPatternMode as
    | "all"
    | "combined"
    | undefined;

  const ocrFilter = action.config.ocrFilter as
    | {
        text?: string;
        matchMode?: string;
        similarity?: number;
      }
    | undefined;

  const topK = (action.config.topK as number) || 1;
  const outputVariable = (action.config.outputVariable as string) || "";

  const handleStateImageSelect = (stateImageId: string) => {
    updateConfig("target", {
      type: "stateImage",
      stateImageId,
    });
  };

  const handleOcrFilterChange = (field: string, value: string | number) => {
    const currentFilter = ocrFilter || {
      text: "",
      matchMode: "contains",
      similarity: 0.8,
    };
    updateConfig("ocrFilter", {
      ...currentFilter,
      [field]: value,
    });
  };

  const handleClearOcrFilter = () => {
    updateConfig("ocrFilter", undefined);
  };

  // Find the selected StateImage for display
  const selectedItem = allStateImages.find(
    (item) => item.stateImage.id === selectedStateImageId
  );

  return (
    <>
      {/* StateImage Selection */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">
          Select Element (StateImage)
        </Label>
        <Select
          value={selectedStateImageId}
          onValueChange={handleStateImageSelect}
        >
          <SelectTrigger className="bg-transparent border-border-default">
            <SelectValue placeholder="Select an element to find" />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default max-h-60">
            {allStateImages.map(({ stateImage, state }) => (
              <SelectItem key={stateImage.id} value={stateImage.id}>
                <div className="flex flex-col">
                  <span>{stateImage.name || stateImage.id}</span>
                  <span className="text-xs text-text-muted">
                    from {state.name}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedItem && (
          <div className="text-xs text-text-muted mt-2">
            Using RAG embeddings to find &quot;{selectedItem.stateImage.name}
            &quot; from state &quot;{selectedItem.state.name}&quot;
            {selectedItem.stateImage.patterns &&
              selectedItem.stateImage.patterns.length > 1 && (
                <span className="ml-2 text-yellow-400">
                  ({selectedItem.stateImage.patterns.length} patterns)
                </span>
              )}
          </div>
        )}
      </div>

      {/* Multi-Pattern Search Mode (shown only when StateImage has multiple patterns) */}
      {selectedItem &&
        selectedItem.stateImage.patterns &&
        selectedItem.stateImage.patterns.length > 1 && (
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">
              Multi-Pattern Search Mode
            </Label>
            <Select
              value={multiPatternMode || "default"}
              onValueChange={(value) =>
                updateConfig(
                  "multiPatternMode",
                  value === "default" ? undefined : value
                )
              }
            >
              <SelectTrigger className="bg-transparent border-border-default">
                <SelectValue placeholder="Use default" />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
                <SelectItem value="default">
                  Use Default
                  {selectedItem.stateImage.ragMultiPatternMode && (
                    <span className="text-xs text-text-muted ml-2">
                      (StateImage: {selectedItem.stateImage.ragMultiPatternMode}
                      )
                    </span>
                  )}
                </SelectItem>
                <SelectItem value="all">Search All Patterns</SelectItem>
                <SelectItem value="combined">Search Combined Vector</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">
              How to search when this StateImage has multiple patterns.
              &quot;All&quot; searches each pattern separately,
              &quot;Combined&quot; uses a single combined vector.
            </p>
          </div>
        )}

      {/* OCR Filter (Optional) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            OCR Text Filter (Optional)
          </Label>
          {ocrFilter?.text && (
            <button
              onClick={handleClearOcrFilter}
              className="text-xs text-text-muted hover:text-text-default"
            >
              Clear
            </button>
          )}
        </div>
        <Input
          value={ocrFilter?.text || ""}
          onChange={(e) => handleOcrFilterChange("text", e.target.value)}
          placeholder="Filter by text content"
          className="bg-transparent border-border-default"
        />
        {ocrFilter?.text && (
          <div className="flex gap-2">
            <Select
              value={ocrFilter?.matchMode || "contains"}
              onValueChange={(value) =>
                handleOcrFilterChange("matchMode", value)
              }
            >
              <SelectTrigger className="bg-transparent border-border-default w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
                <SelectItem value="exact">Exact</SelectItem>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="regex">Regex</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Top K Results */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Max Results</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={topK}
          onChange={(e) => updateConfig("topK", parseInt(e.target.value) || 1)}
          className="bg-transparent border-border-default w-24"
        />
        <p className="text-xs text-text-muted">
          Number of matching locations to return (1-10)
        </p>
      </div>

      {/* Output Variable */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">
          Output Variable (Optional)
        </Label>
        <Input
          value={outputVariable}
          onChange={(e) => updateConfig("outputVariable", e.target.value)}
          placeholder="e.g., foundLocations"
          className="bg-transparent border-border-default"
        />
        <p className="text-xs text-text-muted">
          Store results in this variable for use in later actions
        </p>
      </div>

      {/* Similarity Threshold Override */}
      <SimilarityThresholdOverride
        action={action}
        updateConfig={updateConfig}
      />

      {/* Timing Properties */}
      <TimingProperties action={action} updateConfig={updateConfig} />

      {/* Info Note */}
      <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded text-xs text-blue-300">
        <strong>RAG Find</strong> uses AI embeddings for fast, semantic element
        matching. It requires RAG setup to have been run on the project after
        export.
      </div>
    </>
  );
}
