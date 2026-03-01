import {
  Screenshot,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";
import {
  StateRegion as ContextStateRegion,
  State,
  StateImage,
  Pattern,
} from "../../../contexts/automation-context/types";
import { useAutomation } from "../../../contexts/automation-context";
import {
  convertToContextRegion,
  convertToContextLocation,
} from "../screenshot-annotation-utils";

interface AnnotationStateSetters {
  setScreenshots: React.Dispatch<React.SetStateAction<Screenshot[]>>;
  setSelectedScreenshot: (screenshot: Screenshot | null) => void;
  setSelectedRegion: (region: ScreenshotRegion | null) => void;
  setSelectedLocation: (location: ScreenshotLocation | null) => void;
  setOpenRegions: React.Dispatch<React.SetStateAction<ScreenshotRegion[]>>;
  setOpenLocations: React.Dispatch<React.SetStateAction<ScreenshotLocation[]>>;
  setActiveRegionTab: (id: string | null) => void;
  setActiveLocationTab: (id: string | null) => void;
  setShowRegionPanel: (show: boolean) => void;
  setShowLocationPanel: (show: boolean) => void;
}

interface AnnotationStateValues {
  selectedScreenshot: Screenshot | null;
  openRegions: ScreenshotRegion[];
  openLocations: ScreenshotLocation[];
  activeRegionTab: string | null;
  activeLocationTab: string | null;
}

export function useAnnotationOperations(
  states: State[],
  stateValues: AnnotationStateValues,
  stateSetters: AnnotationStateSetters,
  debouncedSave: () => void
) {
  const {
    screenshots: projectScreenshots,
    updateState,
    updateScreenshot,
  } = useAutomation();

  const {
    selectedScreenshot,
    openRegions,
    openLocations,
    activeRegionTab,
    activeLocationTab,
  } = stateValues;

  const {
    setScreenshots,
    setSelectedScreenshot,
    setSelectedRegion,
    setSelectedLocation,
    setOpenRegions,
    setOpenLocations,
    setActiveRegionTab,
    setActiveLocationTab,
    setShowRegionPanel,
    setShowLocationPanel,
  } = stateSetters;

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
      screenshotContextLocations.map((l: { id: string }) => l.id)
    );
    const existingNonScreenshotLocations = (state.locations || []).filter(
      (l: { id: string }) => !screenshotLocationIds.has(l.id)
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

  return {
    handleRegionCreate,
    handleLocationCreate,
    handleRegionUpdate,
    handleRegionDelete,
    handleLocationUpdate,
    handleLocationDelete,
    handleStateAssociation,
  };
}
