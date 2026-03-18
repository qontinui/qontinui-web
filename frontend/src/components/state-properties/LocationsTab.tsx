"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Trash2, Image as ImageIcon, Info } from "lucide-react";
import { MonitorSelector } from "@/components/monitor-selector";
import { TabsContent } from "@/components/ui/tabs";
import type { State, StateLocation } from "@/stores/automation";

interface LocationsTabProps {
  state: State;
  allStates: State[];
  updateLocation: (
    index: number,
    field: keyof StateLocation,
    value: string | number | number[]
  ) => void;
  removeLocation: (index: number) => void;
}

export function LocationsTab({
  state,
  allStates,
  updateLocation,
  removeLocation,
}: LocationsTabProps) {
  return (
    <TabsContent value="locations" className="flex-1 flex flex-col min-h-0 p-4">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-text-muted">State Locations</Label>
        <Info
          className="w-4 h-4 text-text-muted"
          aria-label="Locations are created in Create Regions & Locations tab"
        />
      </div>
      {state.locations?.length === 0 ? (
        <div className="flex-1 flex items-center justify-center border border-dashed border-border-subtle rounded">
          <p className="text-sm text-text-muted">
            No locations defined. Use Create Regions & Locations tab.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark pr-2">
          <div className="grid grid-cols-2 gap-3">
            {state.locations?.map((location, index) => (
              <div
                key={location.id}
                className="rounded-lg overflow-hidden border-l-4 border-l-brand-success bg-brand-success/[0.03]"
              >
                {/* Header bar with index */}
                <div className="bg-brand-success/15 px-3 py-2 flex items-center gap-2">
                  <span className="text-brand-success text-xs font-bold min-w-[1.25rem]">
                    {index + 1}
                  </span>
                  <span className="text-text-secondary text-xs font-medium truncate flex-1">
                    {location.name || "Unnamed"}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0 text-red-400 hover:text-red-300"
                    onClick={() => removeLocation(index)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {!location.referenceImageId && (
                      <div className="text-xs text-text-muted">
                        <span>
                          ↖ {location.x},{location.y}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Relative positioning details */}
                  {location.referenceImageId && (
                    <details className="text-xs text-text-muted pl-2 border-l-2 border-brand-success/30 mt-1">
                      <summary className="cursor-pointer hover:text-text-secondary list-none flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        <span>Relative to image</span>
                      </summary>
                      <div className="mt-2 space-y-1">
                        <div>
                          Reference:{" "}
                          {(() => {
                            // First check if it's in the current state
                            const imageInCurrentState = state.stateImages?.find(
                              (img) => img.id === location.referenceImageId
                            );
                            if (imageInCurrentState)
                              return imageInCurrentState.name;

                            // Then check in the referenceStateId if it exists
                            if (location.referenceImageId) {
                              // First check current state
                              const imageInState = state.stateImages?.find(
                                (img) => img.id === location.referenceImageId
                              );
                              if (imageInState) return imageInState.name;

                              // Then check all states
                              for (const s of allStates) {
                                const img = s.stateImages?.find(
                                  (img) => img.id === location.referenceImageId
                                );
                                if (img) return img.name;
                              }
                            }
                            return "Unknown";
                          })()}
                        </div>
                        {location.anchorType && (
                          <div>Position: {location.anchorType}</div>
                        )}
                        {(location.percentW !== undefined ||
                          location.percentH !== undefined) && (
                          <div>
                            Offset: {(location.percentW ?? 0) * 100}% W,{" "}
                            {(location.percentH ?? 0) * 100}% H
                          </div>
                        )}
                        {(location.offsetX !== undefined &&
                          location.offsetX !== 0) ||
                        (location.offsetY !== undefined &&
                          location.offsetY !== 0) ? (
                          <div>
                            Offsets: {location.offsetX || 0},{" "}
                            {location.offsetY || 0}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )}

                  {/* Anchor info */}
                  {location.anchor && (
                    <details className="text-xs text-text-muted pl-2 border-l-2 border-brand-success/50 mt-1">
                      <summary className="cursor-pointer hover:text-text-secondary list-none">
                        <span className="inline flex items-center gap-1 text-brand-success">
                          ⚓ Anchor
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1 text-text-muted">
                        <div>
                          Defines:{" "}
                          {location.anchorType
                            ?.replace(/_/g, " ")
                            .replace(/\b\w/g, (l) => l.toUpperCase()) ||
                            "Center"}
                        </div>
                      </div>
                    </details>
                  )}
                  <MonitorSelector
                    monitors={location.monitors || [0]}
                    onChange={(monitors) =>
                      updateLocation(index, "monitors", monitors)
                    }
                    label="Monitors"
                    showLabel={true}
                    showConnectionStatus={false}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </TabsContent>
  );
}
