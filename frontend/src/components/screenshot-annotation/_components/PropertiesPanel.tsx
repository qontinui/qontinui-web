"use client";

import React from "react";
import { X } from "lucide-react";
import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";
import { State } from "../../../contexts/automation-context/types";
import RegionPropertiesPanel from "../../ScreenshotTab/RegionPropertiesPanel";
import LocationPropertiesPanel from "../../ScreenshotTab/LocationPropertiesPanel";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PropertiesPanelProps {
  showRegionPanel: boolean;
  showLocationPanel: boolean;
  openRegions: ScreenshotRegion[];
  openLocations: ScreenshotLocation[];
  activeRegionTab: string | null;
  activeLocationTab: string | null;
  states: State[];
  screenshots: Screenshot[];
  onActiveRegionTabChange: (id: string) => void;
  onActiveLocationTabChange: (id: string) => void;
  onRegionSelect: (region: ScreenshotRegion) => void;
  onLocationSelect: (location: ScreenshotLocation) => void;
  onRegionUpdate: (region: ScreenshotRegion) => void;
  onRegionDelete: (regionId: string) => void;
  onLocationUpdate: (location: ScreenshotLocation) => void;
  onLocationDelete: (locationId: string) => void;
}

const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  showRegionPanel,
  showLocationPanel,
  openRegions,
  openLocations,
  activeRegionTab,
  activeLocationTab,
  states,
  screenshots,
  onActiveRegionTabChange,
  onActiveLocationTabChange,
  onRegionSelect,
  onLocationSelect,
  onRegionUpdate,
  onRegionDelete,
  onLocationUpdate,
  onLocationDelete,
}) => {
  if (showRegionPanel && openRegions.length > 0) {
    return (
      <div className="w-[384px] border-l border-border-subtle bg-surface-raised/50 overflow-hidden flex-shrink-0 flex flex-col">
        {/* Tabs */}
        <div className="bg-surface-raised border-b border-border-default overflow-x-auto">
          <div className="flex">
            {openRegions.map((region) => (
              <div
                key={region.id}
                className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 transition-colors ${
                  activeRegionTab === region.id
                    ? "bg-surface-raised/50 border-brand-primary text-text-primary"
                    : "bg-surface-raised border-transparent text-text-muted hover:bg-surface-overlay"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onActiveRegionTabChange(region.id);
                  onRegionSelect(region);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (() => {
                      onActiveRegionTabChange(region.id);
                      onRegionSelect(region);
                    })();
                  }
                }}
              >
                <span className="text-sm font-medium truncate max-w-[120px]">
                  {region.name}
                </span>
                <button
                  className="h-4 w-4 p-0 hover:bg-surface-overlay rounded flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegionDelete(region.id);
                  }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
        {/* Active Panel */}
        <ScrollArea className="flex-1 h-full">
          {openRegions
            .filter((r) => r.id === activeRegionTab)
            .map((region) => (
              <RegionPropertiesPanel
                key={region.id}
                selectedRegion={region}
                states={states}
                screenshots={screenshots}
                onUpdate={onRegionUpdate}
                onDelete={onRegionDelete}
              />
            ))}
        </ScrollArea>
      </div>
    );
  }

  if (showLocationPanel && openLocations.length > 0) {
    return (
      <div className="w-[384px] border-l border-border-subtle bg-surface-raised/50 overflow-hidden flex-shrink-0 flex flex-col">
        {/* Tabs */}
        <div className="bg-surface-raised border-b border-border-default overflow-x-auto">
          <div className="flex">
            {openLocations.map((location) => (
              <div
                key={location.id}
                className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 transition-colors ${
                  activeLocationTab === location.id
                    ? "bg-surface-raised/50 border-brand-primary text-text-primary"
                    : "bg-surface-raised border-transparent text-text-muted hover:bg-surface-overlay"
                }`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  onActiveLocationTabChange(location.id);
                  onLocationSelect(location);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (() => {
                      onActiveLocationTabChange(location.id);
                      onLocationSelect(location);
                    })();
                  }
                }}
              >
                <span className="text-sm font-medium truncate max-w-[120px]">
                  {location.name}
                </span>
                <button
                  className="h-4 w-4 p-0 hover:bg-surface-overlay rounded flex items-center justify-center"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLocationDelete(location.id);
                  }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
        {/* Active Panel */}
        <ScrollArea className="flex-1 h-full">
          {openLocations
            .filter((l) => l.id === activeLocationTab)
            .map((location) => (
              <LocationPropertiesPanel
                key={location.id}
                selectedLocation={location}
                states={states}
                onUpdate={onLocationUpdate}
                onDelete={onLocationDelete}
              />
            ))}
        </ScrollArea>
      </div>
    );
  }

  return null;
};

export default PropertiesPanel;
