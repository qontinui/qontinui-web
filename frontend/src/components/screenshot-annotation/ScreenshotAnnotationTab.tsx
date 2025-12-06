import React, { useState, useEffect } from "react";
import { MousePointer, Square, Eye, ImageIcon, X } from "lucide-react";
import {
  Screenshot,
  SelectionMode,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../types/Screenshot";
import ScreenshotCanvas from "../ScreenshotTab/ScreenshotCanvas";
import RegionPropertiesPanel from "../ScreenshotTab/RegionPropertiesPanel";
import LocationPropertiesPanel from "../ScreenshotTab/LocationPropertiesPanel";
import StateAssociationPanel from "../ScreenshotTab/StateAssociationPanel";
import AnchorRegionCreator from "../ScreenshotTab/AnchorRegionCreator";
import { useAutomation } from "../../contexts/automation-context";
import {
  StateRegion as ContextStateRegion,
  StateLocation as ContextStateLocation,
} from "../../contexts/automation-context/types";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";

interface ScreenshotAnnotationTabProps {
  states: any[];
}

// Helper function to convert AnchorType to PositionName - currently unused
/*
const convertAnchorTypeToPositionName = (
  anchorType?: AnchorType
): PositionName | undefined => {
  if (!anchorType) return undefined;
  const mapping: Record<AnchorType, PositionName> = {
    TOP_LEFT: "TOPLEFT",
    TOP_CENTER: "TOPMIDDLE",
    TOP_RIGHT: "TOPRIGHT",
    MIDDLE_LEFT: "MIDDLELEFT",
    CENTER: "MIDDLEMIDDLE",
    MIDDLE_RIGHT: "MIDDLERIGHT",
    BOTTOM_LEFT: "BOTTOMLEFT",
    BOTTOM_CENTER: "BOTTOMMIDDLE",
    BOTTOM_RIGHT: "BOTTOMRIGHT",
    CUSTOM: "MIDDLEMIDDLE", // Default to center for custom
  };
  return mapping[anchorType];
};
*/

// Helper function to convert Screenshot Region to Context StateRegion
const convertToContextRegion = (
  region: ScreenshotRegion
): ContextStateRegion => {
  return {
    id: region.id,
    name: region.name,
    x: region.bounds.x,
    y: region.bounds.y,
    width: region.bounds.width,
    height: region.bounds.height,
    isSearchRegion: region.type === "SearchRegion",
    referenceImageId: region.linkedStateObjectId,
  };
};

// Helper function to convert Screenshot Location to Context StateLocation
const convertToContextLocation = (
  location: ScreenshotLocation
): ContextStateLocation => {
  return {
    id: location.id,
    name: location.name,
    x: location.x,
    y: location.y,
    fixed: location.fixed || false,
    anchor: location.anchor || false,
    offsetX: location.offsetX,
    offsetY: location.offsetY,
    referenceImageId: location.referenceImageId,
  };
};

const ScreenshotAnnotationTab: React.FC<ScreenshotAnnotationTabProps> = ({
  states,
}) => {
  const {
    screenshots: projectScreenshots,
    updateState,
    updateScreenshot,
  } = useAutomation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("view");
  const [, setSelectedRegion] = useState<ScreenshotRegion | null>(
    null
  );
  const [, setSelectedLocation] =
    useState<ScreenshotLocation | null>(null);
  const [showRegionPanel, setShowRegionPanel] = useState(false);
  const [showLocationPanel, setShowLocationPanel] = useState(false);
  const [openRegions, setOpenRegions] = useState<ScreenshotRegion[]>([]);
  const [openLocations, setOpenLocations] = useState<ScreenshotLocation[]>([]);
  const [activeRegionTab, setActiveRegionTab] = useState<string | null>(null);
  const [activeLocationTab, setActiveLocationTab] = useState<string | null>(
    null
  );

  // Sync local screenshots with project screenshots
  useEffect(() => {
    const loadScreenshots = async () => {
      const convertedScreenshots: Screenshot[] = await Promise.all(
        projectScreenshots.map(
          (ps) =>
            new Promise<Screenshot>((resolve) => {
              const img = new window.Image();
              img.onload = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: img.width,
                  height: img.height,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: ps.associatedStates || [],
                  regions: ps.regions || [],
                  locations: (ps.locations || []) as any,
                });
              };
              img.onerror = () => {
                resolve({
                  id: ps.id,
                  name: ps.name,
                  imageData: ps.url,
                  width: 0,
                  height: 0,
                  uploadedAt: ps.uploadedAt,
                  associatedStates: ps.associatedStates || [],
                  regions: ps.regions || [],
                  locations: (ps.locations || []) as any,
                });
              };
              img.src = ps.url;
            })
        )
      );
      setScreenshots(convertedScreenshots);

      // Auto-select first screenshot if available and restore its open panels
      if (convertedScreenshots.length > 0 && !selectedScreenshot) {
        const firstScreenshot = convertedScreenshots[0];
        if (firstScreenshot) {
          setSelectedScreenshot(firstScreenshot);

          // Restore open regions if any exist
          if (firstScreenshot.regions?.length > 0) {
            setOpenRegions(firstScreenshot.regions);
            const firstRegion = firstScreenshot.regions[0];
            if (firstRegion) {
              setActiveRegionTab(firstRegion.id);
            }
            setShowRegionPanel(true);
          }

          // Restore open locations if any exist (only if no regions)
          if (
            firstScreenshot.regions?.length === 0 &&
            firstScreenshot.locations?.length > 0
          ) {
            setOpenLocations(firstScreenshot.locations);
            const firstLocation = firstScreenshot.locations[0];
            if (firstLocation) {
              setActiveLocationTab(firstLocation.id);
            }
            setShowLocationPanel(true);
          }
        }
      }
    };

    loadScreenshots();
  }, [projectScreenshots]);

  // Restore open panels when selected screenshot changes
  useEffect(() => {
    if (!selectedScreenshot) return;

    // Restore all regions and locations as open panels for the selected screenshot
    if (selectedScreenshot.regions?.length > 0) {
      setOpenRegions(selectedScreenshot.regions);
      // Keep the currently active tab if it exists in this screenshot, otherwise select first
      const currentTabExists = selectedScreenshot.regions.some(
        (r) => r.id === activeRegionTab
      );
      const firstRegion = selectedScreenshot.regions[0];
      if ((!currentTabExists || !activeRegionTab) && firstRegion) {
        setActiveRegionTab(firstRegion.id);
      }
      setShowRegionPanel(true);
    } else {
      setOpenRegions([]);
      setActiveRegionTab(null);
      setShowRegionPanel(false);
    }

    if (selectedScreenshot.locations?.length > 0) {
      setOpenLocations(selectedScreenshot.locations);
      // Keep the currently active tab if it exists in this screenshot, otherwise select first
      const currentTabExists = selectedScreenshot.locations.some(
        (l) => l.id === activeLocationTab
      );
      const firstLocation = selectedScreenshot.locations[0];
      if ((!currentTabExists || !activeLocationTab) && firstLocation) {
        setActiveLocationTab(firstLocation.id);
      }
      // Only show location panel if no region panel is shown
      if (selectedScreenshot.regions?.length === 0) {
        setShowLocationPanel(true);
      }
    } else {
      setOpenLocations([]);
      setActiveLocationTab(null);
      if (selectedScreenshot.regions?.length === 0) {
        setShowLocationPanel(false);
      }
    }
  }, [selectedScreenshot?.id]);

  // Persist screenshot annotations to context
  const persistScreenshotToContext = async (screenshot: Screenshot) => {
    // Find the corresponding project screenshot
    const projectScreenshot = projectScreenshots.find(
      (ps) => ps.id === screenshot.id
    );
    if (!projectScreenshot) return;

    // Update with regions and locations
    await updateScreenshot({
      ...projectScreenshot,
      regions: screenshot.regions,
      locations: screenshot.locations,
      associatedStates: screenshot.associatedStates,
    });
  };

  const syncRegionsToState = async (
    stateId: string,
    regions: ScreenshotRegion[]
  ) => {
    const state = states.find((s) => s.id === stateId);
    if (!state) return;

    // Separate StateRegions and SearchRegions
    const stateRegions = regions.filter(
      (r: ScreenshotRegion) => r.stateId === stateId && r.type === "StateRegion"
    );
    const searchRegions = regions.filter(
      (r: ScreenshotRegion) => r.type === "SearchRegion" && r.saveToStateImageStateId === stateId
    );

    // Convert StateRegions
    const screenshotContextRegions = stateRegions.map(convertToContextRegion);

    // Get existing StateRegions that are NOT from screenshots (keep them)
    const screenshotRegionIds = new Set(
      screenshotContextRegions.map((r: ContextStateRegion) => r.id)
    );
    const existingNonScreenshotRegions = (state.regions || []).filter(
      (r: ContextStateRegion) => !screenshotRegionIds.has(r.id)
    );

    // Merge StateRegions: keep existing non-screenshot regions + add/update screenshot regions
    const mergedRegions = [
      ...existingNonScreenshotRegions,
      ...screenshotContextRegions,
    ];

    // Handle SearchRegions - they belong to Patterns, not State.regions
    const updatedStateImages = state.stateImages.map((image: any) => {
      // Find SearchRegions for this StateImage using saveToStateImageId
      const searchRegionsForImage = searchRegions.filter(
        (r: ScreenshotRegion) => r.saveToStateImageId === image.id
      );

      if (searchRegionsForImage.length === 0) return image;

      // Add/update SearchRegions in the first pattern
      const updatedPatterns = image.patterns.map((pattern: any, idx: number) => {
        if (idx === 0) {
          // Convert screenshot SearchRegions to Pattern SearchRegions
          const patternSearchRegions = searchRegionsForImage.map((r: ScreenshotRegion) => ({
            id: r.id,
            name: r.name,
            x: r.bounds.x,
            y: r.bounds.y,
            width: r.bounds.width,
            height: r.bounds.height,
            referenceImageId: r.linkedStateObjectId, // Link to the StateImage that defines position
          }));

          // Merge with existing search regions
          const mergedSearchRegions = [
            ...pattern.searchRegions.filter(
              (sr: any) => !patternSearchRegions.find((psr) => psr.id === sr.id)
            ),
            ...patternSearchRegions,
          ];

          return { ...pattern, searchRegions: mergedSearchRegions };
        }
        return pattern;
      });

      return { ...image, patterns: updatedPatterns };
    });

    await updateState({
      ...state,
      regions: mergedRegions,
      stateImages: updatedStateImages,
    });
  };

  const syncLocationsToState = async (
    stateId: string,
    locations: ScreenshotLocation[]
  ) => {
    const state = states.find((s) => s.id === stateId);
    if (!state) return;

    // Convert screenshot locations for this state
    const screenshotContextLocations = locations
      .filter((l: ScreenshotLocation) => l.stateId === stateId)
      .map(convertToContextLocation);

    // Get existing locations that are NOT from screenshots (keep them)
    const screenshotLocationIds = new Set(
      screenshotContextLocations.map((l: ContextStateLocation) => l.id)
    );
    const existingNonScreenshotLocations = (state.locations || []).filter(
      (l: ContextStateLocation) => !screenshotLocationIds.has(l.id)
    );

    // Merge: keep existing non-screenshot locations + add/update screenshot locations
    const mergedLocations = [
      ...existingNonScreenshotLocations,
      ...screenshotContextLocations,
    ];

    await updateState({
      ...state,
      locations: mergedLocations,
    });
  };

  const handleRegionCreate = async (region: ScreenshotRegion) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: [...selectedScreenshot.regions, region],
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(region);

    // Add to open regions and show panel
    if (!openRegions.find((r) => r.id === region.id)) {
      setOpenRegions((prev) => [...prev, region]);
    }
    setActiveRegionTab(region.id);
    setShowRegionPanel(true);

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state
    // For StateRegion, use stateId; for SearchRegion, use saveToStateImageStateId
    const targetStateId =
      region.type === "SearchRegion"
        ? region.saveToStateImageStateId
        : region.stateId;

    if (targetStateId) {
      await syncRegionsToState(targetStateId, updatedScreenshot.regions);
    }
  };

  const handleLocationCreate = async (location: ScreenshotLocation) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: [...selectedScreenshot.locations, location],
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(location);

    // Add to open locations and show panel
    if (!openLocations.find((l) => l.id === location.id)) {
      setOpenLocations((prev) => [...prev, location]);
    }
    setActiveLocationTab(location.id);
    setShowLocationPanel(true);

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state if location has a stateId
    if (location.stateId) {
      await syncLocationsToState(location.stateId, updatedScreenshot.locations);
    }
  };

  const handleRegionUpdate = async (updatedRegion: ScreenshotRegion) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: selectedScreenshot.regions.map((r) =>
        r.id === updatedRegion.id ? updatedRegion : r
      ),
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(updatedRegion);

    // Update in open regions
    setOpenRegions((prev) =>
      prev.map((r) => (r.id === updatedRegion.id ? updatedRegion : r))
    );

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state
    // For StateRegion, use stateId; for SearchRegion, use saveToStateImageStateId
    const targetStateId =
      updatedRegion.type === "SearchRegion"
        ? updatedRegion.saveToStateImageStateId
        : updatedRegion.stateId;

    if (targetStateId) {
      await syncRegionsToState(targetStateId, updatedScreenshot.regions);
    }
  };

  const handleRegionDelete = async (regionId: string) => {
    if (!selectedScreenshot) return;

    const deletedRegion = selectedScreenshot.regions.find(
      (r) => r.id === regionId
    );
    const updatedScreenshot = {
      ...selectedScreenshot,
      regions: selectedScreenshot.regions.filter((r) => r.id !== regionId),
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedRegion(null);

    // Remove from open regions
    setOpenRegions((prev) => prev.filter((r) => r.id !== regionId));
    if (activeRegionTab === regionId) {
      const remaining = openRegions.filter((r) => r.id !== regionId);
      const firstRemaining = remaining[0];
      setActiveRegionTab(remaining.length > 0 && firstRemaining ? firstRemaining.id : null);
      if (remaining.length === 0) {
        setShowRegionPanel(false);
      }
    }

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state if region had a stateId or saveToStateImageStateId
    const targetStateId =
      deletedRegion?.type === "SearchRegion"
        ? deletedRegion.saveToStateImageStateId
        : deletedRegion?.stateId;

    if (targetStateId && deletedRegion) {
      const state = states.find((s) => s.id === targetStateId);
      if (state) {
        if (deletedRegion.type === "StateRegion") {
          // Remove from State.regions array
          const updatedRegions = state.regions?.filter((r: ContextStateRegion) => r.id !== regionId) ?? [];

          await updateState({
            ...state,
            regions: updatedRegions,
          });
        } else if (deletedRegion.type === "SearchRegion") {
          // Remove from Pattern.searchRegions
          const updatedStateImages = state.stateImages.map((image: any) => {
            if (deletedRegion.saveToStateImageId === image.id) {
              const updatedPatterns = image.patterns.map((pattern: any) => ({
                ...pattern,
                searchRegions: pattern.searchRegions.filter(
                  (sr: any) => sr.id !== regionId
                ),
              }));
              return { ...image, patterns: updatedPatterns };
            }
            return image;
          });

          await updateState({
            ...state,
            stateImages: updatedStateImages,
          });
        }
      }
    }
  };

  const handleLocationUpdate = async (updatedLocation: ScreenshotLocation) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: selectedScreenshot.locations.map((l) =>
        l.id === updatedLocation.id ? updatedLocation : l
      ),
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(updatedLocation);

    // Update in open locations
    setOpenLocations((prev) =>
      prev.map((l) => (l.id === updatedLocation.id ? updatedLocation : l))
    );

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state if location has a stateId
    if (updatedLocation.stateId) {
      await syncLocationsToState(
        updatedLocation.stateId,
        updatedScreenshot.locations
      );
    }
  };

  const handleLocationDelete = async (locationId: string) => {
    if (!selectedScreenshot) return;

    const deletedLocation = selectedScreenshot.locations.find(
      (l) => l.id === locationId
    );
    const updatedScreenshot = {
      ...selectedScreenshot,
      locations: selectedScreenshot.locations.filter(
        (l) => l.id !== locationId
      ),
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);
    setSelectedLocation(null);

    // Remove from open locations
    setOpenLocations((prev) => prev.filter((l) => l.id !== locationId));
    if (activeLocationTab === locationId) {
      const remaining = openLocations.filter((l) => l.id !== locationId);
      const firstRemaining = remaining[0];
      setActiveLocationTab(remaining.length > 0 && firstRemaining ? firstRemaining.id : null);
      if (remaining.length === 0) {
        setShowLocationPanel(false);
      }
    }

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);

    // Sync to state if location had a stateId
    if (deletedLocation?.stateId) {
      await syncLocationsToState(
        deletedLocation.stateId,
        updatedScreenshot.locations
      );
    }
  };

  const handleStateAssociation = async (stateIds: string[]) => {
    if (!selectedScreenshot) return;

    const updatedScreenshot = {
      ...selectedScreenshot,
      associatedStates: stateIds,
    };

    setScreenshots((prev) =>
      prev.map((s) => (s.id === selectedScreenshot.id ? updatedScreenshot : s))
    );
    setSelectedScreenshot(updatedScreenshot);

    // Persist to context
    await persistScreenshotToContext(updatedScreenshot);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0A0A0B]">
      {/* Mode Toolbar */}
      <div className="bg-[#27272A] border-b border-gray-800 p-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Annotate Screenshots</span>
          <Badge
            variant="outline"
            className="text-xs border-gray-700 text-gray-400"
          >
            {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""}
          </Badge>
        </div>

        <div className="flex items-center gap-1 bg-[#0A0A0B] rounded p-1">
          <button
            className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
              selectionMode === "view"
                ? "bg-[#00D9FF] text-black"
                : "text-gray-400 hover:text-white hover:bg-[#27272A]"
            }`}
            onClick={() => setSelectionMode("view")}
            title="View mode - Select existing annotations"
          >
            <Eye className="w-4 h-4" />
            View
          </button>
          <button
            className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
              selectionMode === "region" || showRegionPanel
                ? "bg-[#10b981] text-white"
                : "text-gray-400 hover:text-white hover:bg-[#27272A]"
            }`}
            onClick={() => {
              setSelectionMode("region");
              setShowRegionPanel(!showRegionPanel);
              setShowLocationPanel(false);
            }}
            title="Region mode - Draw rectangular regions"
          >
            <Square className="w-4 h-4" />
            Region
          </button>
          <button
            className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
              selectionMode === "location" || showLocationPanel
                ? "bg-[#BD00FF] text-white"
                : "text-gray-400 hover:text-white hover:bg-[#27272A]"
            }`}
            onClick={() => {
              setSelectionMode("location");
              setShowLocationPanel(!showLocationPanel);
              setShowRegionPanel(false);
            }}
            title="Location mode - Place point locations"
          >
            <MousePointer className="w-4 h-4" />
            Location
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Screenshot List */}
        <div className="w-64 border-r border-gray-800 bg-[#27272A]/50 flex flex-col flex-shrink-0">
          <ScrollArea className="flex-1 h-full">
            <div className="p-4">
              {/* Anchor Region Creator */}
              {selectedScreenshot &&
                selectedScreenshot.locations.filter((l) => l.anchor).length >=
                  2 && (
                  <div className="mb-4">
                    <AnchorRegionCreator
                      locations={selectedScreenshot.locations}
                      onRegionCreate={handleRegionCreate}
                    />
                  </div>
                )}

              {screenshots.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No screenshots</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {screenshots.map((screenshot) => (
                    <div
                      key={screenshot.id}
                      className={`group relative p-3 rounded-md cursor-pointer transition-all ${
                        selectedScreenshot?.id === screenshot.id
                          ? "bg-[#27272A] border-2 border-[#00D9FF] ring-2 ring-[#00D9FF]/50"
                          : "bg-[#27272A] border-2 border-gray-700 hover:border-gray-600"
                      }`}
                      onClick={() => setSelectedScreenshot(screenshot)}
                    >
                      <div className="aspect-video relative overflow-hidden rounded bg-gray-800 mb-2">
                        <img
                          src={screenshot.imageData}
                          alt={screenshot.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-sm font-medium truncate text-gray-200 mb-2">
                        {screenshot.name}
                      </p>

                      <div className="flex items-center gap-2 text-xs">
                        {screenshot.regions.length > 0 && (
                          <div className="flex items-center gap-1 text-[#10b981]">
                            <Square className="w-3 h-3" />
                            <span>{screenshot.regions.length}</span>
                          </div>
                        )}
                        {screenshot.locations.length > 0 && (
                          <div className="flex items-center gap-1 text-[#ef4444]">
                            <MousePointer className="w-3 h-3" />
                            <span>{screenshot.locations.length}</span>
                          </div>
                        )}
                      </div>

                      {screenshot.associatedStates.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {screenshot.associatedStates.map((stateId) => {
                            const state = states.find((s) => s.id === stateId);
                            return state ? (
                              <Badge
                                key={stateId}
                                variant="outline"
                                className="text-xs border-[#00D9FF] text-[#00D9FF]"
                              >
                                {state.name}
                              </Badge>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {selectedScreenshot ? (
            <>
              <ScreenshotCanvas
                screenshot={selectedScreenshot}
                selectionMode={selectionMode}
                zoomMode="fit"
                onRegionCreate={handleRegionCreate}
                onLocationCreate={handleLocationCreate}
                onRegionSelect={setSelectedRegion}
                onLocationSelect={setSelectedLocation}
              />
              <StateAssociationPanel
                screenshot={selectedScreenshot}
                states={states}
                onStateAssociation={handleStateAssociation}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 bg-[#F3F4F6]">
              <div className="text-center">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">
                  Select a screenshot to annotate
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {showRegionPanel && openRegions.length > 0 ? (
          <div className="w-[384px] border-l border-gray-800 bg-[#27272A]/50 overflow-hidden flex-shrink-0 flex flex-col">
            {/* Tabs */}
            <div className="bg-[#27272A] border-b border-gray-700 overflow-x-auto">
              <div className="flex">
                {openRegions.map((region) => (
                  <div
                    key={region.id}
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 transition-colors ${
                      activeRegionTab === region.id
                        ? "bg-[#27272A]/50 border-[#00D9FF] text-black"
                        : "bg-[#27272A] border-transparent text-gray-400 hover:bg-gray-200"
                    }`}
                    onClick={() => {
                      setActiveRegionTab(region.id);
                      setSelectedRegion(region);
                    }}
                  >
                    <span className="text-sm font-medium truncate max-w-[120px]">
                      {region.name}
                    </span>
                    <button
                      className="h-4 w-4 p-0 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRegionDelete(region.id);
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
                    onUpdate={handleRegionUpdate}
                    onDelete={handleRegionDelete}
                  />
                ))}
            </ScrollArea>
          </div>
        ) : showLocationPanel && openLocations.length > 0 ? (
          <div className="w-[384px] border-l border-gray-800 bg-[#27272A]/50 overflow-hidden flex-shrink-0 flex flex-col">
            {/* Tabs */}
            <div className="bg-[#27272A] border-b border-gray-700 overflow-x-auto">
              <div className="flex">
                {openLocations.map((location) => (
                  <div
                    key={location.id}
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer border-b-2 transition-colors ${
                      activeLocationTab === location.id
                        ? "bg-[#27272A]/50 border-[#00D9FF] text-black"
                        : "bg-[#27272A] border-transparent text-gray-400 hover:bg-gray-200"
                    }`}
                    onClick={() => {
                      setActiveLocationTab(location.id);
                      setSelectedLocation(location);
                    }}
                  >
                    <span className="text-sm font-medium truncate max-w-[120px]">
                      {location.name}
                    </span>
                    <button
                      className="h-4 w-4 p-0 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLocationDelete(location.id);
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
                    onUpdate={handleLocationUpdate}
                    onDelete={handleLocationDelete}
                  />
                ))}
            </ScrollArea>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ScreenshotAnnotationTab;
