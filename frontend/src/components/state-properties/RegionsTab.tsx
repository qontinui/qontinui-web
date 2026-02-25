"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2, Info, Link2 } from "lucide-react";
import { MonitorSelector } from "@/components/monitor-selector";
import { TabsContent } from "@/components/ui/tabs";
import type { State, StateRegion } from "@/stores/automation";

interface RegionsTabProps {
  state: State;
  allStates: State[];
  updateRegion: (
    index: number,
    field: keyof StateRegion,
    value: string | number | number[]
  ) => void;
  removeRegion: (index: number) => void;
}

export function RegionsTab({
  state,
  allStates,
  updateRegion,
  removeRegion,
}: RegionsTabProps) {
  return (
    <TabsContent value="regions" className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-text-muted">State Regions</Label>
        <Info
          className="w-4 h-4 text-text-muted"
          aria-label="Regions are created in Create Regions & Locations tab"
        />
      </div>
      {state.regions?.length === 0 ? (
        <div className="flex-1 flex items-center justify-center border border-dashed border-border-subtle rounded">
          <p className="text-sm text-text-muted">
            No regions defined. Use Create Regions & Locations tab.
          </p>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-3 overflow-y-auto scrollbar-dark pr-2 content-start">
          {state.regions?.map((region, index) => {
            // Check if this region has a linked reference image
            const hasLinkedPosition = !!region.referenceImageId;
            let linkedInfo = null;

            if (hasLinkedPosition) {
              // Find the state and image that this region is linked to
              const linkedState = allStates.find((s) =>
                s.stateImages?.some((img) => img.id === region.referenceImageId)
              );
              const linkedImage = linkedState?.stateImages?.find(
                (img) => img.id === region.referenceImageId
              );
              linkedInfo = {
                stateName: linkedState?.name || "Unknown State",
                imageName: linkedImage?.name || "Unknown Image",
              };
            }

            return (
              <div
                key={region.id}
                className="rounded-lg overflow-hidden border-l-4 border-l-brand-secondary bg-brand-secondary/[0.03]"
              >
                {/* Header bar with index */}
                <div className="bg-brand-secondary/15 px-3 py-2 flex items-center gap-2">
                  <span className="text-brand-secondary text-xs font-bold min-w-[1.25rem]">
                    {index + 1}
                  </span>
                  <span className="text-text-secondary text-xs font-medium truncate flex-1">
                    {region.name || "Unnamed"}
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {hasLinkedPosition && linkedInfo ? (
                        <div className="text-xs text-text-muted mt-1 flex items-center gap-1.5">
                          <Link2 className="w-3 h-3 flex-shrink-0" />
                          {linkedInfo.stateName} → {linkedInfo.imageName}
                        </div>
                      ) : (
                        <div className="text-xs text-text-muted mt-1">
                          ↖ {region.x},{region.y} ↔ {region.width} ↕{" "}
                          {region.height}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                      onClick={() => removeRegion(index)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                  <MonitorSelector
                    monitors={region.monitors || [0]}
                    onChange={(monitors) =>
                      updateRegion(index, "monitors", monitors)
                    }
                    label="Monitors"
                    showLabel={true}
                    showConnectionStatus={false}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </TabsContent>
  );
}
