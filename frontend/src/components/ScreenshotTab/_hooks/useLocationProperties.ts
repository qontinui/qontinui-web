import { useState } from "react";
import { ScreenshotLocation, AnchorType } from "../../../types/Screenshot";
import { State } from "../../../contexts/automation-context/types";

interface UseLocationPropertiesArgs {
  selectedLocation: ScreenshotLocation;
  states: State[];
  onUpdate: (location: ScreenshotLocation) => void;
}

export function useLocationProperties({
  selectedLocation,
  states,
  onUpdate,
}: UseLocationPropertiesArgs) {
  const [location, setLocation] =
    useState<ScreenshotLocation>(selectedLocation);
  const [prevSelectedLocation, setPrevSelectedLocation] =
    useState<ScreenshotLocation>(selectedLocation);
  const [showSaved, setShowSaved] = useState(false);

  if (selectedLocation !== prevSelectedLocation) {
    setPrevSelectedLocation(selectedLocation);
    setLocation(selectedLocation);
  }

  const showSavedIndicator = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const updateLocation = (updatedLocation: ScreenshotLocation) => {
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
    showSavedIndicator();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateLocation({ ...location, name: e.target.value });
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    updateLocation({ ...location, [axis]: value });
  };

  const handleRelativeToggle = (checked: boolean) => {
    if (checked) {
      updateLocation({
        ...location,
        referenceImageId: "pending",
        fixed: false,
      });
    } else {
      updateLocation({
        ...location,
        referenceImageId: undefined,
        fixed: true,
      });
    }
  };

  const handleReferenceStateChange = (referenceStateId: string) => {
    const selectedState = states.find((s) => s.id === referenceStateId);
    const firstImage = selectedState?.stateImages?.[0];
    updateLocation({
      ...location,
      referenceStateId: referenceStateId || undefined,
      referenceImageId: firstImage?.id || "pending",
    });
  };

  const handleReferenceImageChange = (referenceImageId: string) => {
    updateLocation({ ...location, referenceImageId });
  };

  const ANCHOR_PERCENTAGES: Record<
    AnchorType,
    { percentW: number; percentH: number }
  > = {
    TOP_LEFT: { percentW: 0.0, percentH: 0.0 },
    TOP_CENTER: { percentW: 0.5, percentH: 0.0 },
    TOP_RIGHT: { percentW: 1.0, percentH: 0.0 },
    MIDDLE_LEFT: { percentW: 0.0, percentH: 0.5 },
    CENTER: { percentW: 0.5, percentH: 0.5 },
    MIDDLE_RIGHT: { percentW: 1.0, percentH: 0.5 },
    BOTTOM_LEFT: { percentW: 0.0, percentH: 1.0 },
    BOTTOM_CENTER: { percentW: 0.5, percentH: 1.0 },
    BOTTOM_RIGHT: { percentW: 1.0, percentH: 1.0 },
    CUSTOM: { percentW: 0.5, percentH: 0.5 },
  };

  const handleAnchorTypeInRegion = (anchorType: AnchorType) => {
    updateLocation({
      ...location,
      anchorType,
      percentW: ANCHOR_PERCENTAGES[anchorType].percentW,
      percentH: ANCHOR_PERCENTAGES[anchorType].percentH,
    });
  };

  const handlePercentChange = (
    field: "percentW" | "percentH",
    value: number
  ) => {
    updateLocation({ ...location, [field]: value });
  };

  const handleOffsetChange = (field: "offsetX" | "offsetY", value: number) => {
    updateLocation({ ...location, [field]: value });
  };

  const handleAnchorToggle = (checked: boolean) => {
    updateLocation({
      ...location,
      anchor: checked,
      anchorType: checked ? location.anchorType || "CENTER" : undefined,
    });
  };

  const handleAnchorPositionChange = (anchorType: AnchorType) => {
    updateLocation({ ...location, anchorType });
  };

  const handleStateChange = (stateId: string) => {
    updateLocation({ ...location, stateId });
  };

  return {
    location,
    showSaved,
    handleNameChange,
    handleCoordinateChange,
    handleRelativeToggle,
    handleReferenceStateChange,
    handleReferenceImageChange,
    handleAnchorTypeInRegion,
    handlePercentChange,
    handleOffsetChange,
    handleAnchorToggle,
    handleAnchorPositionChange,
    handleStateChange,
  };
}
