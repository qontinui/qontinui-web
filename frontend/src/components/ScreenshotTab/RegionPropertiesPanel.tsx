import React, { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import { ScreenshotRegion, Screenshot } from "../../types/Screenshot";

interface State {
  id: string;
  name: string;
  stateImages?: Array<{
    id: string;
    name: string;
  }>;
}

interface RegionPropertiesPanelProps {
  selectedRegion: ScreenshotRegion;
  states: State[];
  screenshots: Screenshot[];
  onUpdate: (region: ScreenshotRegion) => void;
  onDelete: (regionId: string) => void;
}

const RegionPropertiesPanel: React.FC<RegionPropertiesPanelProps> = ({
  selectedRegion,
  states,
  onUpdate,
  onDelete,
}) => {
  const [region, setRegion] = useState<ScreenshotRegion>(selectedRegion);
  const [showSaved, setShowSaved] = useState(false);
  const [linkToMatch, setLinkToMatch] = useState(false);
  const [linkedMatchState, setLinkedMatchState] = useState<string>("");
  const [linkedMatchImage, setLinkedMatchImage] = useState<string>("");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    setRegion(selectedRegion);
    const hasLinkedImage = !!selectedRegion.linkedStateObjectId;

    // Only update linkToMatch during initialization or when the region changes
    if (isInitializing || selectedRegion.id !== region.id) {
      setLinkToMatch(hasLinkedImage);
      setIsInitializing(false);
    }

    if (hasLinkedImage) {
      // Find the state containing the linked image
      const state = states.find((s) =>
        s.stateImages?.some(
          (img) => img.id === selectedRegion.linkedStateObjectId
        )
      );
      if (state) {
        setLinkedMatchState(state.id);
        setLinkedMatchImage(selectedRegion.linkedStateObjectId ?? "");
      }
    } else if (isInitializing || selectedRegion.id !== region.id) {
      // Only clear local state during initialization or region change
      setLinkedMatchState("");
      setLinkedMatchImage("");
    }
  }, [selectedRegion, states, isInitializing, region.id]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const updatedRegion = { ...region, name: e.target.value };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
    showSavedIndicator();
  };

  const showSavedIndicator = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleTypeChange = (type: "StateRegion" | "SearchRegion") => {
    const updatedRegion = { ...region, type };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
  };

  const handleBoundsChange = (
    field: "x" | "y" | "width" | "height",
    value: number
  ) => {
    const updatedRegion = {
      ...region,
      bounds: {
        ...region.bounds,
        [field]: value,
      },
    };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
  };

  const handleLinkToMatchChange = (checked: boolean) => {
    setLinkToMatch(checked);
    if (!checked) {
      // Clear the link
      const updatedRegion = {
        ...region,
        linkedStateObjectId: undefined,
        linkedStateObjectType: undefined,
      };
      setRegion(updatedRegion);
      onUpdate(updatedRegion);
      setLinkedMatchState("");
      setLinkedMatchImage("");
    }
  };

  const handleLinkedMatchStateChange = (stateId: string) => {
    setLinkedMatchState(stateId);
    setLinkedMatchImage(""); // Reset image when state changes
    // Don't clear linkedStateObjectId here - just reset the image selection
    // The linkToMatch checkbox should remain checked
  };

  const handleLinkedMatchImageChange = (imageId: string) => {
    setLinkedMatchImage(imageId);
    const updatedRegion = {
      ...region,
      linkedStateObjectId: imageId,
      linkedStateObjectType: "StateImage" as const,
    };
    setRegion(updatedRegion);
    onUpdate(updatedRegion);
    showSavedIndicator();
  };

  return (
    <>
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">
              Region Properties
            </h3>
            {showSaved && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                <Check className="w-3 h-3" />
                Saved
              </span>
            )}
          </div>
          <button
            onClick={() => onDelete(region.id)}
            className="p-1 hover:bg-gray-200 rounded"
            title="Delete region"
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
            value={region.name}
            onChange={handleNameChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        {/* Type Toggle */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Region Type
          </label>
          <div className="flex gap-2">
            <button
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                region.type === "StateRegion"
                  ? "bg-green-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              onClick={() => handleTypeChange("StateRegion")}
            >
              StateRegion
            </button>
            <button
              className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                region.type === "SearchRegion"
                  ? "bg-yellow-500 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              onClick={() => handleTypeChange("SearchRegion")}
            >
              SearchRegion
            </button>
          </div>
        </div>

        {/* Save to State (for StateRegion) */}
        {region.type === "StateRegion" && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Save to State
            </label>
            <select
              value={region.stateId}
              onChange={(e) => {
                const updatedRegion = { ...region, stateId: e.target.value };
                setRegion(updatedRegion);
                onUpdate(updatedRegion);
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
        )}

        {/* Select State and Save to StateImage (for SearchRegion) */}
        {region.type === "SearchRegion" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select State
              </label>
              <select
                value={region.saveToStateImageStateId || ""}
                onChange={(e) => {
                  const updatedRegion = {
                    ...region,
                    saveToStateImageStateId: e.target.value || undefined,
                    saveToStateImageId: undefined, // Reset image selection when state changes
                  };
                  setRegion(updatedRegion);
                  onUpdate(updatedRegion);
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
              <p className="text-xs text-gray-500 mt-1">
                This populates the StateImage dropdown below
              </p>
            </div>

            {region.saveToStateImageStateId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Save to StateImage
                </label>
                <select
                  value={region.saveToStateImageId || ""}
                  onChange={(e) => {
                    const updatedRegion = {
                      ...region,
                      saveToStateImageId: e.target.value || undefined,
                    };
                    setRegion(updatedRegion);
                    onUpdate(updatedRegion);
                    showSavedIndicator();
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">Select StateImage</option>
                  {states
                    .find((s) => s.id === region.saveToStateImageStateId)
                    ?.stateImages?.map((stateImage) => (
                      <option key={stateImage.id} value={stateImage.id}>
                        {stateImage.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  SearchRegion will be saved to this StateImage
                </p>
              </div>
            )}
          </>
        )}

        {/* Link to StateImage Match Checkbox */}
        <div className="pt-2 border-t border-gray-300">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="link-to-match"
              checked={linkToMatch}
              onChange={(e) => handleLinkToMatchChange(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label
              htmlFor="link-to-match"
              className="text-sm font-medium text-gray-700"
            >
              Link to StateImage Match
            </label>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-6">
            Position and size will be determined at runtime by the linked image
            match
          </p>
        </div>

        {/* Position & Size (greyed when linked) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position & Size
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                className={`block text-xs ${linkToMatch ? "text-gray-400" : "text-gray-500"}`}
              >
                X
              </label>
              <input
                type="number"
                value={region.bounds.x}
                onChange={(e) =>
                  handleBoundsChange("x", Number(e.target.value))
                }
                disabled={linkToMatch}
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  linkToMatch
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
            <div>
              <label
                className={`block text-xs ${linkToMatch ? "text-gray-400" : "text-gray-500"}`}
              >
                Y
              </label>
              <input
                type="number"
                value={region.bounds.y}
                onChange={(e) =>
                  handleBoundsChange("y", Number(e.target.value))
                }
                disabled={linkToMatch}
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  linkToMatch
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
            <div>
              <label
                className={`block text-xs ${linkToMatch ? "text-gray-400" : "text-gray-500"}`}
              >
                Width
              </label>
              <input
                type="number"
                value={region.bounds.width}
                onChange={(e) =>
                  handleBoundsChange("width", Number(e.target.value))
                }
                disabled={linkToMatch}
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  linkToMatch
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
            <div>
              <label
                className={`block text-xs ${linkToMatch ? "text-gray-400" : "text-gray-500"}`}
              >
                Height
              </label>
              <input
                type="number"
                value={region.bounds.height}
                onChange={(e) =>
                  handleBoundsChange("height", Number(e.target.value))
                }
                disabled={linkToMatch}
                className={`w-full px-2 py-1 border border-gray-300 rounded text-sm ${
                  linkToMatch
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "text-gray-900"
                }`}
              />
            </div>
          </div>
        </div>

        {/* State and Linked Image dropdowns (only visible when link is checked) */}
        {linkToMatch && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                State
              </label>
              <select
                value={linkedMatchState}
                onChange={(e) => handleLinkedMatchStateChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
              >
                <option value="">Select state</option>
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                State of the linked image (populates Linked Image dropdown)
              </p>
            </div>

            {linkedMatchState && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Linked Image
                </label>
                <select
                  value={linkedMatchImage}
                  onChange={(e) => handleLinkedMatchImageChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">Select StateImage</option>
                  {states
                    .find((s) => s.id === linkedMatchState)
                    ?.stateImages?.map((stateImage) => (
                      <option key={stateImage.id} value={stateImage.id}>
                        {stateImage.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  The linked StateImage will define this region&apos;s position
                  at runtime
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default RegionPropertiesPanel;
