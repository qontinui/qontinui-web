import React, { useState, useEffect } from "react";
import { X, Anchor, MousePointer, Image, Check } from "lucide-react";
import {
  ScreenshotLocation,
  Screenshot,
  AnchorType,
} from "../../types/Screenshot";
import { StateImage } from "../../contexts/automation-context/types";

interface LocationPropertiesPanelProps {
  selectedLocation: ScreenshotLocation;
  states: any[]; // Will be replaced with proper State type
  screenshots: Screenshot[];
  onUpdate: (location: ScreenshotLocation) => void;
  onDelete: (locationId: string) => void;
}

const LocationPropertiesPanel: React.FC<LocationPropertiesPanelProps> = ({
  selectedLocation,
  states,
  screenshots,
  onUpdate,
  onDelete,
}) => {
  const [location, setLocation] =
    useState<ScreenshotLocation>(selectedLocation);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    setLocation(selectedLocation);
  }, [selectedLocation]);

  const showSavedIndicator = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updatedLocation = { ...location, name: e.target.value };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
    showSavedIndicator();
  };

  const handleCoordinateChange = (axis: "x" | "y", value: number) => {
    const updatedLocation = {
      ...location,
      [axis]: value,
    };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
    showSavedIndicator();
  };

  const handlePropertyToggle = (property: "anchor" | "fixed") => {
    const updatedLocation = {
      ...location,
      [property]: !location[property],
    };
    setLocation(updatedLocation);
    onUpdate(updatedLocation);
  };

  const getScreenshot = () => {
    return screenshots.find((s) => s.id === location.screenshotId);
  };

  return (
    <>
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">
              Location Properties
            </h3>
            {showSaved && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <button
            onClick={() => onDelete(location.id)}
            className="p-1 hover:bg-gray-200 rounded"
            title="Delete location"
          >
            <X className="w-4 h-4 text-gray-700" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            type="text"
            value={location.name}
            onChange={handleNameChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        {/* Coordinates */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                className={`block text-xs ${location.referenceImageId && location.referenceImageId !== "pending" ? "text-gray-400" : "text-gray-500"}`}
              >
                X
              </label>
              <input
                type="number"
                value={location.x}
                onChange={(e) =>
                  handleCoordinateChange("x", Number(e.target.value))
                }
                disabled={
                  !!(
                    location.referenceImageId &&
                    location.referenceImageId !== "pending"
                  )
                }
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  location.referenceImageId &&
                  location.referenceImageId !== "pending"
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
            <div>
              <label
                className={`block text-xs ${location.referenceImageId && location.referenceImageId !== "pending" ? "text-gray-400" : "text-gray-500"}`}
              >
                Y
              </label>
              <input
                type="number"
                value={location.y}
                onChange={(e) =>
                  handleCoordinateChange("y", Number(e.target.value))
                }
                disabled={
                  !!(
                    location.referenceImageId &&
                    location.referenceImageId !== "pending"
                  )
                }
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  location.referenceImageId &&
                  location.referenceImageId !== "pending"
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
          </div>
        </div>

        {/* Relative Positioning Checkbox - Always Visible */}
        <div className="space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer p-2 bg-gray-50 rounded hover:bg-gray-100">
            <input
              type="checkbox"
              checked={!!location.referenceImageId}
              onChange={(e) => {
                if (e.target.checked) {
                  // Just set fixed to false - user will select state and image
                  const updatedLocation = {
                    ...location,
                    referenceImageId: "pending", // Placeholder to trigger the UI
                    fixed: false,
                  };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                  showSavedIndicator();
                } else {
                  const updatedLocation = {
                    ...location,
                    referenceImageId: undefined,
                    fixed: true,
                  };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                  showSavedIndicator();
                }
              }}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 font-medium">
              Relative positioning
            </span>
          </label>

          {location.referenceImageId && (
            <div className="pl-6 space-y-2">
              {/* Associated State - Only when relative is checked */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Associated State
                </label>
                <select
                  value={location.referenceStateId || ""}
                  onChange={(e) => {
                    const referenceStateId = e.target.value;
                    const selectedState = states.find(
                      (s) => s.id === referenceStateId
                    );
                    const firstImage = selectedState?.stateImages?.[0];

                    const updatedLocation = {
                      ...location,
                      referenceStateId: referenceStateId || undefined,
                      // Auto-select first image if state has images
                      referenceImageId: firstImage?.id || "pending",
                    };
                    setLocation(updatedLocation);
                    onUpdate(updatedLocation);
                    showSavedIndicator();
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">Select a state</option>
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reference Image */}
              {location.referenceStateId &&
                states.find((s) => s.id === location.referenceStateId)
                  ?.stateImages?.length > 0 && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Reference Image
                    </label>
                    <select
                      value={
                        location.referenceImageId === "pending"
                          ? ""
                          : location.referenceImageId
                      }
                      onChange={(e) => {
                        const updatedLocation = {
                          ...location,
                          referenceImageId: e.target.value,
                        };
                        setLocation(updatedLocation);
                        onUpdate(updatedLocation);
                        showSavedIndicator();
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900"
                    >
                      <option value="">Select an image</option>
                      {states
                        .find((s) => s.id === location.referenceStateId)
                        ?.stateImages?.map((stateImage: StateImage) => (
                          <option key={stateImage.id} value={stateImage.id}>
                            {stateImage.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

              {/* Location in Region for Relative */}
              <details className="group" open>
                <summary className="flex items-center justify-between cursor-pointer text-sm text-gray-700 hover:text-gray-900 list-none py-1 px-2 bg-gray-50 rounded">
                  <span className="font-medium">Location in Region</span>
                  <span className="text-gray-400 group-open:rotate-90 transition-transform">
                    ▶
                  </span>
                </summary>
                <div className="mt-2 pl-2 border-l-2 border-blue-300 space-y-3">
                  {/* Position Enum */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Position
                    </label>
                    <select
                      value={location.anchorType || "CENTER"}
                      onChange={(e) => {
                        const anchorType = e.target.value as AnchorType;
                        const percentages: Record<
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
                        const updatedLocation = {
                          ...location,
                          anchorType,
                          percentW: percentages[anchorType].percentW,
                          percentH: percentages[anchorType].percentH,
                        };
                        setLocation(updatedLocation);
                        onUpdate(updatedLocation);
                        showSavedIndicator();
                      }}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                    >
                      <option value="TOP_LEFT">Top Left</option>
                      <option value="TOP_CENTER">Top Center</option>
                      <option value="TOP_RIGHT">Top Right</option>
                      <option value="MIDDLE_LEFT">Middle Left</option>
                      <option value="CENTER">Center</option>
                      <option value="MIDDLE_RIGHT">Middle Right</option>
                      <option value="BOTTOM_LEFT">Bottom Left</option>
                      <option value="BOTTOM_CENTER">Bottom Center</option>
                      <option value="BOTTOM_RIGHT">Bottom Right</option>
                    </select>
                  </div>

                  {/* Percent of Width/Height */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Percent of Width/Height
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400">
                          W%
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={location.percentW ?? 0.5}
                          onChange={(e) => {
                            const updatedLocation = {
                              ...location,
                              percentW: parseFloat(e.target.value),
                            };
                            setLocation(updatedLocation);
                            onUpdate(updatedLocation);
                            showSavedIndicator();
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400">
                          H%
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={location.percentH ?? 0.5}
                          onChange={(e) => {
                            const updatedLocation = {
                              ...location,
                              percentH: parseFloat(e.target.value),
                            };
                            setLocation(updatedLocation);
                            onUpdate(updatedLocation);
                            showSavedIndicator();
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      0.0 = left/top, 0.5 = center, 1.0 = right/bottom
                    </p>
                  </div>

                  {/* Pixel Offsets */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Offsets (pixels)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-400">X</label>
                        <input
                          type="number"
                          value={location.offsetX || 0}
                          onChange={(e) => {
                            const updatedLocation = {
                              ...location,
                              offsetX: Number(e.target.value),
                            };
                            setLocation(updatedLocation);
                            onUpdate(updatedLocation);
                            showSavedIndicator();
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400">Y</label>
                        <input
                          type="number"
                          value={location.offsetY || 0}
                          onChange={(e) => {
                            const updatedLocation = {
                              ...location,
                              offsetY: Number(e.target.value),
                            };
                            setLocation(updatedLocation);
                            onUpdate(updatedLocation);
                            showSavedIndicator();
                          }}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>

        {/* Anchor Checkbox - Independent */}
        <div className="space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer p-2 bg-gray-50 rounded hover:bg-gray-100">
            <input
              type="checkbox"
              checked={location.anchor || false}
              onChange={(e) => {
                const updatedLocation = {
                  ...location,
                  anchor: e.target.checked,
                  anchorType: e.target.checked
                    ? location.anchorType || "CENTER"
                    : undefined,
                };
                setLocation(updatedLocation);
                onUpdate(updatedLocation);
                showSavedIndicator();
              }}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 font-medium">
              Anchor (for region definition)
            </span>
          </label>

          {location.anchor && (
            <div className="pl-6">
              <label className="block text-xs text-gray-500 mb-1">
                Anchor Position
              </label>
              <select
                value={location.anchorType || "CENTER"}
                onChange={(e) => {
                  const updatedLocation = {
                    ...location,
                    anchorType: e.target.value as AnchorType,
                  };
                  setLocation(updatedLocation);
                  onUpdate(updatedLocation);
                  showSavedIndicator();
                }}
                className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
              >
                <option value="TOP_LEFT">Top Left</option>
                <option value="TOP_CENTER">Top Center</option>
                <option value="TOP_RIGHT">Top Right</option>
                <option value="MIDDLE_LEFT">Middle Left</option>
                <option value="CENTER">Center</option>
                <option value="MIDDLE_RIGHT">Middle Right</option>
                <option value="BOTTOM_LEFT">Bottom Left</option>
                <option value="BOTTOM_CENTER">Bottom Center</option>
                <option value="BOTTOM_RIGHT">Bottom Right</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Specifies which point of a region this location represents
              </p>
            </div>
          )}
        </div>

        {/* Save to State - Always Visible */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Save to State
          </label>
          <select
            value={location.stateId || ""}
            onChange={(e) => {
              const updatedLocation = { ...location, stateId: e.target.value };
              setLocation(updatedLocation);
              onUpdate(updatedLocation);
              showSavedIndicator();
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          >
            <option value="">Select state</option>
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
};

export default LocationPropertiesPanel;
