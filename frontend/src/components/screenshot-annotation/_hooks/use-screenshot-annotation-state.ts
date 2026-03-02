import { useState, useEffect, useRef, useCallback } from "react";
import {
  Screenshot,
  SelectionMode,
  ScreenshotRegion,
  ScreenshotLocation,
} from "../../../types/Screenshot";
import { State } from "../../../contexts/automation-context/types";
import { useAutomation } from "../../../contexts/automation-context";
import { useDebouncedCallback } from "../../../hooks/use-debounced-callback";
import { useScreenshotCapture } from "../../common/_hooks/useScreenshotCapture";
import { useAnnotationOperations } from "./use-annotation-operations";
import { toast } from "sonner";

export function useScreenshotAnnotationState(states: State[]) {
  const {
    screenshots: projectScreenshots,
    addScreenshot,
    triggerSave,
  } = useAutomation();

  // Core annotation state
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

  // File upload/project screenshot refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotSelectorTriggerRef = useRef<HTMLButtonElement>(null);

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

  // File upload handler: reads file as base64, validates, and adds to automation context
  const handleFileUpload = useCallback(
    async (file: File) => {
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
    },
    [addScreenshot]
  );

  // Screenshot capture (uses the consolidated common hook)
  const capture = useScreenshotCapture({
    onUploadScreenshot: handleFileUpload,
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0 && files[0]) {
        handleFileUpload(files[0]);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [handleFileUpload]
  );

  const handleSelectProjectScreenshot = useCallback(
    (screenshotId: string) => {
      const screenshot = screenshots.find((s) => s.id === screenshotId);
      if (screenshot) {
        setSelectedScreenshot(screenshot);
      }
    },
    [screenshots]
  );

  // Annotation CRUD operations
  const operations = useAnnotationOperations(
    states,
    {
      selectedScreenshot,
      openRegions,
      openLocations,
      activeRegionTab,
      activeLocationTab,
    },
    {
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
    },
    debouncedSave
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedScreenshot?.id]);

  return {
    // State
    screenshots,
    selectedScreenshot,
    setSelectedScreenshot,
    selectionMode,
    setSelectionMode,
    setSelectedRegion,
    setSelectedLocation,
    showRegionPanel,
    setShowRegionPanel,
    showLocationPanel,
    setShowLocationPanel,
    openRegions,
    openLocations,
    activeRegionTab,
    setActiveRegionTab,
    activeLocationTab,
    setActiveLocationTab,
    saveStatus,

    // Capture state (from common hook)
    isCapturing: capture.isCapturing,
    showMonitorMenu: capture.showMonitorMenu,
    runnerMonitors: capture.runnerMonitors,
    monitorMenuRef: capture.monitorMenuRef,

    // File/project screenshot refs and handlers
    fileInputRef,
    screenshotSelectorTriggerRef,
    handleFileSelect,
    handleSelectProjectScreenshot,

    // Capture handlers
    handleOpenMonitorMenu: capture.handleOpenMonitorMenu,
    handleCaptureFromScreen: capture.captureSingleMonitor,

    // Operations (CRUD handlers)
    ...operations,
  };
}
