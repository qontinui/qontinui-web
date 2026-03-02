import React from "react";
import { ScreenshotLocation, AnchorType } from "../../../types/Screenshot";
import { StateImage, State } from "../../../contexts/automation-context/types";

interface RelativePositioningSectionProps {
  location: ScreenshotLocation;
  states: State[];
  onRelativeToggle: (checked: boolean) => void;
  onReferenceStateChange: (stateId: string) => void;
  onReferenceImageChange: (imageId: string) => void;
  onAnchorTypeInRegion: (anchorType: AnchorType) => void;
  onPercentChange: (field: "percentW" | "percentH", value: number) => void;
  onOffsetChange: (field: "offsetX" | "offsetY", value: number) => void;
}

const RelativePositioningSection: React.FC<RelativePositioningSectionProps> = ({
  location,
  states,
  onRelativeToggle,
  onReferenceStateChange,
  onReferenceImageChange,
  onAnchorTypeInRegion,
  onPercentChange,
  onOffsetChange,
}) => {
  const referenceState = states.find((s) => s.id === location.referenceStateId);
  const referenceImages = referenceState?.stateImages ?? [];

  return (
    <div className="space-y-2">
      <label className="flex items-center space-x-2 cursor-pointer p-2 bg-surface-raised rounded hover:bg-surface-raised/80">
        <input
          type="checkbox"
          checked={!!location.referenceImageId}
          onChange={(e) => onRelativeToggle(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
        />
        <span className="text-sm text-text-secondary font-medium">
          Relative positioning
        </span>
      </label>

      {location.referenceImageId && (
        <div className="pl-6 space-y-2">
          <div>
            <label
              htmlFor="lpp-ref-state"
              className="block text-xs text-text-muted mb-1"
            >
              Associated State
            </label>
            <select
              id="lpp-ref-state"
              value={location.referenceStateId || ""}
              onChange={(e) => onReferenceStateChange(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-text-primary"
            >
              <option value="">Select a state</option>
              {states.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </div>

          {location.referenceStateId && referenceImages.length > 0 && (
            <div>
              <label
                htmlFor="lpp-ref-image"
                className="block text-xs text-text-muted mb-1"
              >
                Reference Image
              </label>
              <select
                id="lpp-ref-image"
                value={
                  location.referenceImageId === "pending"
                    ? ""
                    : location.referenceImageId
                }
                onChange={(e) => onReferenceImageChange(e.target.value)}
                className="w-full px-3 py-2 border border-border-default rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-text-primary"
              >
                <option value="">Select an image</option>
                {referenceImages.map((stateImage: StateImage) => (
                  <option key={stateImage.id} value={stateImage.id}>
                    {stateImage.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <LocationInRegionDetails
            location={location}
            onAnchorTypeInRegion={onAnchorTypeInRegion}
            onPercentChange={onPercentChange}
            onOffsetChange={onOffsetChange}
          />
        </div>
      )}
    </div>
  );
};

interface LocationInRegionDetailsProps {
  location: ScreenshotLocation;
  onAnchorTypeInRegion: (anchorType: AnchorType) => void;
  onPercentChange: (field: "percentW" | "percentH", value: number) => void;
  onOffsetChange: (field: "offsetX" | "offsetY", value: number) => void;
}

const LocationInRegionDetails: React.FC<LocationInRegionDetailsProps> = ({
  location,
  onAnchorTypeInRegion,
  onPercentChange,
  onOffsetChange,
}) => (
  <details className="group" open>
    <summary className="flex items-center justify-between cursor-pointer text-sm text-text-secondary hover:text-text-primary list-none py-1 px-2 bg-surface-raised rounded">
      <span className="font-medium">Location in Region</span>
      <span className="text-text-muted group-open:rotate-90 transition-transform">
        ▶
      </span>
    </summary>
    <div className="mt-2 pl-2 border-l-2 border-blue-300 space-y-3">
      <div>
        <label
          htmlFor="lpp-anchor-type"
          className="block text-xs text-text-muted mb-1"
        >
          Position
        </label>
        <select
          id="lpp-anchor-type"
          value={location.anchorType || "CENTER"}
          onChange={(e) => onAnchorTypeInRegion(e.target.value as AnchorType)}
          className="w-full px-2 py-1 border border-border-default rounded text-sm text-text-primary"
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

      <div>
        <p className="block text-xs text-text-muted mb-1">
          Percent of Width/Height
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="lpp-percent-w"
              className="block text-xs text-text-muted"
            >
              W%
            </label>
            <input
              id="lpp-percent-w"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={location.percentW ?? 0.5}
              onChange={(e) =>
                onPercentChange("percentW", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 border border-border-default rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label
              htmlFor="lpp-percent-h"
              className="block text-xs text-text-muted"
            >
              H%
            </label>
            <input
              id="lpp-percent-h"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={location.percentH ?? 0.5}
              onChange={(e) =>
                onPercentChange("percentH", parseFloat(e.target.value))
              }
              className="w-full px-2 py-1 border border-border-default rounded text-sm text-text-primary"
            />
          </div>
        </div>
        <p className="text-xs text-text-muted mt-1">
          0.0 = left/top, 0.5 = center, 1.0 = right/bottom
        </p>
      </div>

      <div>
        <p className="block text-xs text-text-muted mb-1">Offsets (pixels)</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="lpp-offset-x"
              className="block text-xs text-text-muted"
            >
              X
            </label>
            <input
              id="lpp-offset-x"
              type="number"
              value={location.offsetX || 0}
              onChange={(e) =>
                onOffsetChange("offsetX", Number(e.target.value))
              }
              className="w-full px-2 py-1 border border-border-default rounded text-sm text-text-primary"
            />
          </div>
          <div>
            <label
              htmlFor="lpp-offset-y"
              className="block text-xs text-text-muted"
            >
              Y
            </label>
            <input
              id="lpp-offset-y"
              type="number"
              value={location.offsetY || 0}
              onChange={(e) =>
                onOffsetChange("offsetY", Number(e.target.value))
              }
              className="w-full px-2 py-1 border border-border-default rounded text-sm text-text-primary"
            />
          </div>
        </div>
      </div>
    </div>
  </details>
);

export default RelativePositioningSection;
