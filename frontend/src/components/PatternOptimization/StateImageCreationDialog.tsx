"use client";

import React, { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { Info, MapPin, Search } from "lucide-react";
import type {
  ExtractedPattern,
  OptimizationStrategy,
} from "@/types/pattern-optimization";

interface StateImageCreationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patterns: ExtractedPattern[];
  strategy: OptimizationStrategy;
  onCreateStateImage: (config: StateImageConfig) => void;
}

export interface StateImageConfig {
  stateName: string;
  stateId: string | null;
  imageNames: string[];
  includeSearchRegions: boolean;
  searchRegionName?: string;
  createNewState: boolean;
}

export function StateImageCreationDialog({
  isOpen,
  onClose,
  patterns,
  strategy,
  onCreateStateImage,
}: StateImageCreationDialogProps) {
  const { states } = useAutomation();

  const [createNewState, setCreateNewState] = useState(false);
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [newStateName, setNewStateName] = useState("");
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [includeSearchRegions, setIncludeSearchRegions] = useState(true);
  const [searchRegionName, setSearchRegionName] = useState(
    "Pattern Search Region"
  );

  // Initialize image names based on patterns (only once)
  useEffect(() => {
    if (patterns.length > 0 && imageNames.length === 0) {
      const names = patterns.map((_, idx) => `Pattern_${idx + 1}`);
      setImageNames(names);
    }
  }, [patterns.length]); // Only depend on length, not the array itself

  // Auto-select first state if available
  useEffect(() => {
    if (states.length > 0 && !selectedStateId) {
      setSelectedStateId(states[0]?.id ?? "");
    }
  }, [states, selectedStateId]);

  const handleImageNameChange = useCallback((index: number, value: string) => {
    setImageNames((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  }, []);

  const handleCreate = useCallback(() => {
    // Validation
    if (createNewState && !newStateName.trim()) {
      toast.error("Please enter a name for the new state");
      return;
    }

    if (!createNewState && !selectedStateId) {
      toast.error("Please select a state");
      return;
    }

    if (imageNames.some((name) => !name.trim())) {
      toast.error("Please provide names for all StateImages");
      return;
    }

    // Check for duplicate names
    const uniqueNames = new Set(imageNames);
    if (uniqueNames.size !== imageNames.length) {
      toast.error("StateImage names must be unique");
      return;
    }

    const config: StateImageConfig = {
      stateName: createNewState
        ? newStateName
        : states.find((s) => s.id === selectedStateId)?.name || "",
      stateId: createNewState ? null : selectedStateId,
      imageNames,
      includeSearchRegions,
      searchRegionName: includeSearchRegions ? searchRegionName : undefined,
      createNewState,
    };

    onCreateStateImage(config);
    onClose();
  }, [
    createNewState,
    newStateName,
    selectedStateId,
    imageNames,
    includeSearchRegions,
    searchRegionName,
    states,
    onCreateStateImage,
    onClose,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create StateImages from Optimized Patterns</DialogTitle>
          <DialogDescription>
            Add the optimized patterns as StateImages to your project. They will
            be used for visual state identification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* State Selection */}
          <Card className="bg-surface-raised/50 border-border-default">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-brand-primary" />
                <Label className="text-sm font-medium">Target State</Label>
              </div>

              <RadioGroup
                value={createNewState ? "new" : "existing"}
                onValueChange={(value) => setCreateNewState(value === "new")}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="existing" id="existing-state" />
                  <Label htmlFor="existing-state" className="flex-1">
                    Add to existing state
                  </Label>
                </div>
                {!createNewState && (
                  <div className="ml-6 mt-2">
                    <Select
                      value={selectedStateId}
                      onValueChange={setSelectedStateId}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a state" />
                      </SelectTrigger>
                      <SelectContent>
                        {states.map((state) => (
                          <SelectItem key={state.id} value={state.id}>
                            {state.name}
                            {state.stateImages?.length > 0 && (
                              <span className="ml-2 text-xs text-text-muted">
                                ({state.stateImages.length} images)
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="new" id="new-state" />
                  <Label htmlFor="new-state" className="flex-1">
                    Create new state
                  </Label>
                </div>
                {createNewState && (
                  <div className="ml-6 mt-2">
                    <Input
                      placeholder="Enter state name"
                      value={newStateName}
                      onChange={(e) => setNewStateName(e.target.value)}
                      className="w-full"
                    />
                  </div>
                )}
              </RadioGroup>
            </CardContent>
          </Card>

          {/* StateImage Names */}
          <Card className="bg-surface-raised/50 border-border-default">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-brand-primary" />
                <Label className="text-sm font-medium">StateImage Names</Label>
              </div>

              <div className="space-y-2">
                {patterns.map((pattern, idx) => (
                  <div key={pattern.id} className="flex items-center gap-2">
                    <div className="w-16 h-16 bg-surface-raised rounded border border-border-default flex items-center justify-center overflow-hidden">
                      {pattern.imageUrl ? (
                        <img
                          src={pattern.imageUrl}
                          alt={`Pattern ${idx + 1}`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <span className="text-xs text-text-muted">
                          P{idx + 1}
                        </span>
                      )}
                    </div>
                    <Input
                      value={imageNames[idx] || ""}
                      onChange={(e) =>
                        handleImageNameChange(idx, e.target.value)
                      }
                      placeholder={`Name for pattern ${idx + 1}`}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>

              <div className="text-xs text-text-muted">
                {patterns.length} pattern{patterns.length > 1 ? "s" : ""} will
                be added using the{" "}
                <span className="font-medium text-brand-primary">
                  {strategy.type}
                </span>{" "}
                strategy
              </div>
            </CardContent>
          </Card>

          {/* Search Regions */}
          <Card className="bg-surface-raised/50 border-border-default">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-brand-primary" />
                  <Label className="text-sm font-medium">Search Regions</Label>
                </div>
                <Checkbox
                  checked={includeSearchRegions}
                  onCheckedChange={(checked) =>
                    setIncludeSearchRegions(checked as boolean)
                  }
                />
              </div>

              {includeSearchRegions && (
                <>
                  <div className="text-xs text-text-muted">
                    The bounding boxes you drew will be added as search regions
                    for each StateImage. This limits where the pattern will be
                    searched on the screen.
                  </div>
                  <div>
                    <Label htmlFor="search-region-name" className="text-xs">
                      Search Region Name
                    </Label>
                    <Input
                      id="search-region-name"
                      value={searchRegionName}
                      onChange={(e) => setSearchRegionName(e.target.value)}
                      placeholder="Name for search regions"
                      className="mt-1"
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className="bg-blue-500/10 border-blue-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-blue-300">
                <span className="font-medium">Summary:</span> Will create{" "}
                {patterns.length} StateImage
                {patterns.length > 1 ? "s" : ""} in{" "}
                {createNewState ? (
                  <span className="font-medium">
                    new state &quot;{newStateName}&quot;
                  </span>
                ) : (
                  <span className="font-medium">
                    state &quot;
                    {states.find((s) => s.id === selectedStateId)?.name}&quot;
                  </span>
                )}
                {includeSearchRegions && " with search regions"}.
              </p>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            Create StateImages
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
