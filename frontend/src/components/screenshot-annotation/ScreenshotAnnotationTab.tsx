import React, { useState, useEffect, useRef } from "react";
import {
  MousePointer,
  Square,
  Eye,
  ImageIcon,
  X,
  Upload,
  FolderOpen,
  Camera,
  Monitor,
  Loader2,
  Check,
} from "lucide-react";
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
  State,
  StateImage,
  Pattern,
} from "../../contexts/automation-context/types";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { ScreenshotSelector } from "../screenshot-selector";
import { toast } from "sonner";
import { useDebouncedCallback } from "../../hooks/use-debounced-callback";

interface ScreenshotAnnotationTabProps {
  states: State[];
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

interface MonitorInfo {
  index: number;
  width: number;
  height: number;
  is_primary: boolean;
}

const ScreenshotAnnotationTab: React.FC<ScreenshotAnnotationTabProps> = ({
  states,
}) => {
  const {
    screenshots: projectScreenshots,
    updateState,
    updateScreenshot,
    addScreenshot,
    triggerSave,
  } = useAutomation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] =
    useState<Screenshot | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("view");
  const [, setSelectedRegion] = useState<ScreenshotRegion | null>(null);
  const [, setSelectedLocation] = useState<ScreenshotLocation | null>(null);
  const [showRegionPanel, setShowRegionPanel] = useState(false);
  const [showLocationPanel, setShowLocationPanel] = useState(false);
  const [openRegions, setOpenRegions] = useState<ScreenshotRegion[]>([]);
  const [openLocations, setOpenLocations] = useState<ScreenshotLocation[]>([]);
  const [activeRegionTab, setActiveRegionTab] = useState<string | null>(null);
  const [activeLocationTab, setActiveLocationTab] = useState<string | null>(
    null
  );

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const saveStatusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced auto-save function (2.5 second delay)
  const [debouncedSave] = useDebouncedCallback(() => {
    setSaveStatus("saving");
    triggerSave();

    // Show "Saved" status for 2 seconds
    if (saveStatusTimeoutRef.current) {
      clearTimeout(saveStatusTimeoutRef.current);
    }
    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saved");
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
      }, 2000);
    }, 100);
  }, 2500);

  // Screenshot upload/capture state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);
  const monitorMenuRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showMonitorMenu, setShowMonitorMenu] = useState(false);
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);

  // Close monitor menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        monitorMenuRef.current &&
        !monitorMenuRef.current.contains(event.target as Node)
      ) {
        setShowMonitorMenu(false);
      }
    };

    if (showMonitorMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMonitorMenu]);

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        if (img.width < 10 || img.height < 10) {
          toast.error("Image too small", {
            description: `${file.name} is ${img.width}x${img.height}px. Images must be at least 10x10 pixels.`,
          });
          return;
        }

        const newScreenshot = {
          id: `screenshot-${Date.now()}`,
          name: file.name,
          url: base64,
          size: file.size,
          uploadedAt: new Date(),
        };

        addScreenshot(newScreenshot);
        toast.success("Screenshot uploaded successfully");
      };
      img.onerror = () => {
        toast.error("Failed to process image", {
          description: `${file.name} could not be loaded.`,
        });
      };
      img.src = base64;
    };
    reader.readAsDataURL(file);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0 && files[0]) {
      handleFileUpload(files[0]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSelectProjectScreenshot = (screenshotId: string) => {
    const screenshot = screenshots.find((s) => s.id === screenshotId);
    if (screenshot) {
      setSelectedScreenshot(screenshot);
    }
  };

  const handleOpenMonitorMenu = async () => {
    setShowMonitorMenu(true);
    try {
      // Use the runner API for screenshot capture
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";
      const response = await fetch(`${apiUrl}/api/capture/screenshot/monitors`);
      if (response.ok) {
        const data = await response.json();
        setAvailableMonitors(data.monitors || []);
      }
    } catch (error) {
      console.error("Failed to fetch monitors:", error);
      setAvailableMonitors([
        { index: 0, width: 1920, height: 1080, is_primary: true },
      ]);
    }
  };

  const handleCaptureFromScreen = async (monitorIndex: number | null) => {
    setShowMonitorMenu(false);
    setIsCapturing(true);

    try {
      // Use the runner API for screenshot capture
      const apiUrl =
        process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";
      const monitorParam =
        monitorIndex !== null ? `&monitor=${monitorIndex}` : "";
      const response = await fetch(
        `${apiUrl}/api/capture/screenshot/current?quality=95${monitorParam}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          errorText || `Failed to capture screenshot: ${response.statusText}`
        );
      }

      const data = await response.json();
      const byteCharacters = atob(data.screenshot_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "image/png" });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const monitorLabel =
        monitorIndex !== null ? `monitor${monitorIndex}_` : "";
      const filename = `screenshot_${monitorLabel}${timestamp}.png`;
      const file = new File([blob], filename, { type: "image/png" });

      handleFileUpload(file);

      toast.success("Screenshot captured", {
        description: `${data.width}x${data.height} pixels`,
      });
    } catch (error: unknown) {
      console.error("Screenshot capture failed:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Make sure the runner is running on port 9876";
      toast.error("Failed to capture screenshot", {
        description: errorMessage,
      });
    } finally {
      setIsCapturing(false);
    }
  };

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
                  locations: (ps.locations || []) as ScreenshotLocation[],
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
                  locations: (ps.locations || []) as ScreenshotLocation[],
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
      (r: ScreenshotRegion) =>
        r.type === "SearchRegion" && r.saveToStateImageStateId === stateId
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
    const updatedStateImages = state.stateImages.map((image: StateImage) => {
      // Find SearchRegions for this StateImage using saveToStateImageId
      const searchRegionsForImage = searchRegions.filter(
        (r: ScreenshotRegion) => r.saveToStateImageId === image.id
      );

      if (searchRegionsForImage.length === 0) return image;

      // Add/update SearchRegions in the first pattern
      const updatedPatterns = image.patterns.map(
        (pattern: Pattern, idx: number) => {
          if (idx === 0) {
            // Convert screenshot SearchRegions to Pattern SearchRegions
            const patternSearchRegions = searchRegionsForImage.map(
              (r: ScreenshotRegion) => ({
                id: r.id,
                name: r.name,
                x: r.bounds.x,
                y: r.bounds.y,
                width: r.bounds.width,
                height: r.bounds.height,
                referenceImageId: r.linkedStateObjectId, // Link to the StateImage that defines position
              })
            );

            // Merge with existing search regions
            const mergedSearchRegions = [
              ...pattern.searchRegions.filter(
                (sr) => !patternSearchRegions.find((psr) => psr.id === sr.id)
              ),
              ...patternSearchRegions,
            ];

            return { ...pattern, searchRegions: mergedSearchRegions };
          }
          return pattern;
        }
      );

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

    // Trigger auto-save
    debouncedSave();
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

    // Trigger auto-save
    debouncedSave();
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

    // Trigger auto-save
    debouncedSave();
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
      setActiveRegionTab(
        remaining.length > 0 && firstRemaining ? firstRemaining.id : null
      );
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
          const updatedRegions =
            state.regions?.filter(
              (r: ContextStateRegion) => r.id !== regionId
            ) ?? [];

          await updateState({
            ...state,
            regions: updatedRegions,
          });
        } else if (deletedRegion.type === "SearchRegion") {
          // Remove from Pattern.searchRegions
          const updatedStateImages = state.stateImages.map(
            (image: StateImage) => {
              if (deletedRegion.saveToStateImageId === image.id) {
                const updatedPatterns = image.patterns.map(
                  (pattern: Pattern) => ({
                    ...pattern,
                    searchRegions: pattern.searchRegions.filter(
                      (sr) => sr.id !== regionId
                    ),
                  })
                );
                return { ...image, patterns: updatedPatterns };
              }
              return image;
            }
          );

          await updateState({
            ...state,
            stateImages: updatedStateImages,
          });
        }
      }
    }

    // Trigger auto-save
    debouncedSave();
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

    // Trigger auto-save
    debouncedSave();
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
      setActiveLocationTab(
        remaining.length > 0 && firstRemaining ? firstRemaining.id : null
      );
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

    // Trigger auto-save
    debouncedSave();
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

    // Trigger auto-save
    debouncedSave();
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface-canvas">
      {/* Mode Toolbar */}
      <div className="bg-surface-raised border-b border-border-subtle p-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Annotate Screenshots</span>
          <Badge
            variant="outline"
            className="text-xs border-border-default text-text-muted"
          >
            {screenshots.length} screenshot{screenshots.length !== 1 ? "s" : ""}
          </Badge>
          {saveStatus === "saving" && (
            <div className="flex items-center gap-1 text-xs text-text-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Saving...</span>
            </div>
          )}
          {saveStatus === "saved" && (
            <div className="flex items-center gap-1 text-xs text-brand-success">
              <Check className="w-3 h-3" />
              <span>Saved</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 bg-surface-canvas rounded p-1">
          <button
            className={`px-3 py-2 rounded flex items-center gap-2 text-sm font-medium transition-colors ${
              selectionMode === "view"
                ? "bg-brand-primary text-black"
                : "text-text-muted hover:text-white hover:bg-surface-raised"
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
                ? "bg-emerald-500 text-white"
                : "text-text-muted hover:text-white hover:bg-surface-raised"
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
                ? "bg-brand-secondary text-white"
                : "text-text-muted hover:text-white hover:bg-surface-raised"
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
        <div className="w-64 border-r border-border-subtle bg-surface-raised/50 flex flex-col flex-shrink-0">
          {/* Screenshot Actions */}
          <div className="p-3 border-b border-border-subtle">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-text-secondary">
                Screenshots
              </h3>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-3 py-2 bg-brand-primary text-black rounded-md hover:bg-brand-primary/90 text-sm flex items-center justify-center gap-2 font-medium"
              >
                <Upload className="w-4 h-4" />
                Upload Image
              </button>
              <button
                onClick={() => screenshotSelectorTriggerRef.current?.click()}
                className="w-full px-3 py-2 bg-brand-success text-black rounded-md hover:bg-brand-success/90 text-sm flex items-center justify-center gap-2 font-medium"
              >
                <FolderOpen className="w-4 h-4" />
                From Project
              </button>

              {/* Capture from Screen button */}
              <div className="relative" ref={monitorMenuRef}>
                <button
                  onClick={handleOpenMonitorMenu}
                  disabled={isCapturing}
                  className="w-full px-3 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-secondary/90 text-sm flex items-center justify-center gap-2 font-medium disabled:opacity-50"
                >
                  {isCapturing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Camera className="w-4 h-4" />
                  )}
                  {isCapturing ? "Capturing..." : "Capture Screen"}
                </button>

                {showMonitorMenu && (
                  <div className="absolute left-0 right-0 mt-2 bg-surface-raised rounded-md shadow-lg z-10 border border-border-default">
                    <div className="py-1">
                      <div className="px-3 py-2 text-xs text-text-muted border-b border-border-default">
                        Select monitor
                      </div>
                      {availableMonitors.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-text-muted flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </div>
                      ) : (
                        <>
                          {availableMonitors.map((monitor) => (
                            <button
                              key={monitor.index}
                              onClick={() =>
                                handleCaptureFromScreen(monitor.index)
                              }
                              className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay flex items-center gap-2"
                            >
                              <Monitor className="w-4 h-4" />
                              <span className="flex-1">
                                Monitor {monitor.index + 1}
                                {monitor.is_primary && (
                                  <span className="text-xs text-brand-success ml-1">
                                    (Primary)
                                  </span>
                                )}
                              </span>
                              <span className="text-xs text-text-muted">
                                {monitor.width}×{monitor.height}
                              </span>
                            </button>
                          ))}
                          {availableMonitors.length > 1 && (
                            <>
                              <div className="border-t border-border-default my-1"></div>
                              <button
                                onClick={() => handleCaptureFromScreen(null)}
                                className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-surface-overlay flex items-center gap-2"
                              >
                                <Monitor className="w-4 h-4" />
                                All Monitors
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            {/* Hidden Screenshot Selector Trigger */}
            <ScreenshotSelector
              selectedScreenshot={selectedScreenshot?.id || ""}
              onSelectScreenshot={handleSelectProjectScreenshot}
              multiSelect={false}
              allowUpload={false}
              trigger={
                <button
                  ref={screenshotSelectorTriggerRef}
                  style={{ display: "none" }}
                />
              }
            />
          </div>

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
                <div className="text-center py-8 text-text-muted">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">No screenshots</p>
                  <p className="text-xs mt-1">Upload or select from project</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {screenshots.map((screenshot) => (
                    <div
                      key={screenshot.id}
                      className={`group relative p-3 rounded-md cursor-pointer transition-all ${
                        selectedScreenshot?.id === screenshot.id
                          ? "bg-surface-raised border-2 border-brand-primary ring-2 ring-brand-primary/50"
                          : "bg-surface-raised border-2 border-border-default hover:border-border-subtle"
                      }`}
                      onClick={() => setSelectedScreenshot(screenshot)}
                    >
                      <div className="aspect-video relative overflow-hidden rounded bg-surface-overlay mb-2">
                        <img
                          src={screenshot.imageData}
                          alt={screenshot.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <p className="text-sm font-medium truncate text-text-secondary mb-2">
                        {screenshot.name}
                      </p>

                      <div className="flex items-center gap-2 text-xs">
                        {screenshot.regions.length > 0 && (
                          <div className="flex items-center gap-1 text-emerald-500">
                            <Square className="w-3 h-3" />
                            <span>{screenshot.regions.length}</span>
                          </div>
                        )}
                        {screenshot.locations.length > 0 && (
                          <div className="flex items-center gap-1 text-red-500">
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
                                className="text-xs border-brand-primary text-brand-primary"
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
            <div className="flex-1 flex items-center justify-center text-text-muted bg-surface-inset">
              <div className="text-center">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">
                  Select a screenshot to annotate
                </p>
                <p className="text-sm mt-2 text-text-muted">
                  Upload, capture, or select from project screenshots
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Properties Panel */}
        {showRegionPanel && openRegions.length > 0 ? (
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
                    onClick={() => {
                      setActiveRegionTab(region.id);
                      setSelectedRegion(region);
                    }}
                  >
                    <span className="text-sm font-medium truncate max-w-[120px]">
                      {region.name}
                    </span>
                    <button
                      className="h-4 w-4 p-0 hover:bg-surface-overlay rounded flex items-center justify-center"
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
                    onClick={() => {
                      setActiveLocationTab(location.id);
                      setSelectedLocation(location);
                    }}
                  >
                    <span className="text-sm font-medium truncate max-w-[120px]">
                      {location.name}
                    </span>
                    <button
                      className="h-4 w-4 p-0 hover:bg-surface-overlay rounded flex items-center justify-center"
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
