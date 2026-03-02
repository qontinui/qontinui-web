import React from "react";
import { ScreenshotLocation } from "../../types/Screenshot";
import { State } from "../../contexts/automation-context/types";
import { useLocationProperties } from "./_hooks/useLocationProperties";
import PanelHeader from "./_components/PanelHeader";
import NameField from "./_components/NameField";
import CoordinateFields from "./_components/CoordinateFields";
import RelativePositioningSection from "./_components/RelativePositioningSection";
import AnchorSection from "./_components/AnchorSection";
import SaveToStateField from "./_components/SaveToStateField";

interface LocationPropertiesPanelProps {
  selectedLocation: ScreenshotLocation;
  states: State[];
  onUpdate: (location: ScreenshotLocation) => void;
  onDelete: (locationId: string) => void;
}

const LocationPropertiesPanel: React.FC<LocationPropertiesPanelProps> = ({
  selectedLocation,
  states,
  onUpdate,
  onDelete,
}) => {
  const {
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
  } = useLocationProperties({ selectedLocation, states, onUpdate });

  return (
    <>
      <PanelHeader
        showSaved={showSaved}
        onDelete={() => onDelete(location.id)}
      />

      <div className="p-4 space-y-4">
        <NameField value={location.name} onChange={handleNameChange} />

        <CoordinateFields
          location={location}
          onCoordinateChange={handleCoordinateChange}
        />

        <RelativePositioningSection
          location={location}
          states={states}
          onRelativeToggle={handleRelativeToggle}
          onReferenceStateChange={handleReferenceStateChange}
          onReferenceImageChange={handleReferenceImageChange}
          onAnchorTypeInRegion={handleAnchorTypeInRegion}
          onPercentChange={handlePercentChange}
          onOffsetChange={handleOffsetChange}
        />

        <AnchorSection
          location={location}
          onAnchorToggle={handleAnchorToggle}
          onAnchorPositionChange={handleAnchorPositionChange}
        />

        <SaveToStateField
          stateId={location.stateId}
          states={states}
          onChange={handleStateChange}
        />
      </div>
    </>
  );
};

export default LocationPropertiesPanel;
