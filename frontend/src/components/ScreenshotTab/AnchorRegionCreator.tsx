import React, { useState } from "react";
import { Plus, Anchor } from "lucide-react";
import { ScreenshotLocation, ScreenshotRegion } from "../../types/Screenshot";
import {
  createRegionFromAnchors,
  canCreateRegionFromAnchors,
  getAnchorTypeName,
} from "../../lib/region-utils";

interface AnchorRegionCreatorProps {
  locations: ScreenshotLocation[];
  onRegionCreate: (region: ScreenshotRegion) => void;
}

const AnchorRegionCreator: React.FC<AnchorRegionCreatorProps> = ({
  locations,
  onRegionCreate,
}) => {
  const [anchor1Id, setAnchor1Id] = useState<string>("");
  const [anchor2Id, setAnchor2Id] = useState<string>("");
  const [regionName, setRegionName] = useState<string>("");

  // Filter locations to only show anchors
  const anchors = locations.filter((loc) => loc.anchor);

  const handleCreateRegion = () => {
    const anchor1 = anchors.find((a) => a.id === anchor1Id);
    const anchor2 = anchors.find((a) => a.id === anchor2Id);

    if (!anchor1 || !anchor2) return;

    if (!canCreateRegionFromAnchors(anchor1, anchor2)) {
      alert("Cannot create a valid region from these anchors");
      return;
    }

    const region = createRegionFromAnchors(
      anchor1,
      anchor2,
      anchor1.screenshotId,
      anchor1.stateId,
      regionName || undefined
    );

    onRegionCreate(region);

    // Reset form
    setAnchor1Id("");
    setAnchor2Id("");
    setRegionName("");
  };

  const isValid = () => {
    const anchor1 = anchors.find((a) => a.id === anchor1Id);
    const anchor2 = anchors.find((a) => a.id === anchor2Id);
    return canCreateRegionFromAnchors(anchor1 || null, anchor2 || null);
  };

  if (anchors.length < 2) {
    return (
      <div className="p-4 bg-surface-canvas rounded-lg">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Anchor className="w-4 h-4" />
          <span>Need at least 2 anchor locations to create a region</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-lg border">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Anchor className="w-4 h-4" />
        Create Region from Anchors
      </h3>

      <div className="space-y-3">
        {/* First Anchor Selection */}
        <div>
          <label
            htmlFor="arc-anchor1"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            First Anchor Point
          </label>
          <select
            id="arc-anchor1"
            value={anchor1Id}
            onChange={(e) => setAnchor1Id(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-border-default rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select first anchor</option>
            {anchors.map((anchor) => (
              <option key={anchor.id} value={anchor.id}>
                {anchor.name} ({getAnchorTypeName(anchor.anchorType)})
              </option>
            ))}
          </select>
        </div>

        {/* Second Anchor Selection */}
        <div>
          <label
            htmlFor="arc-anchor2"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            Second Anchor Point
          </label>
          <select
            id="arc-anchor2"
            value={anchor2Id}
            onChange={(e) => setAnchor2Id(e.target.value)}
            className="w-full px-2 py-1 text-sm border border-border-default rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!anchor1Id}
          >
            <option value="">Select second anchor</option>
            {anchors
              .filter((a) => a.id !== anchor1Id)
              .map((anchor) => (
                <option key={anchor.id} value={anchor.id}>
                  {anchor.name} ({getAnchorTypeName(anchor.anchorType)})
                </option>
              ))}
          </select>
        </div>

        {/* Region Name */}
        <div>
          <label
            htmlFor="arc-region-name"
            className="block text-xs font-medium text-text-secondary mb-1"
          >
            Region Name (optional)
          </label>
          <input
            id="arc-region-name"
            type="text"
            value={regionName}
            onChange={(e) => setRegionName(e.target.value)}
            placeholder="Auto-generated if empty"
            className="w-full px-2 py-1 text-sm border border-border-default rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!anchor2Id}
          />
        </div>

        {/* Create Button */}
        <button
          onClick={handleCreateRegion}
          disabled={!isValid()}
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isValid()
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-surface-raised/80 text-text-muted cursor-not-allowed"
          }`}
        >
          <Plus className="w-4 h-4" />
          Create Region
        </button>

        {/* Info Text */}
        {anchor1Id && anchor2Id && (
          <div className="text-xs text-text-muted p-2 bg-blue-50 rounded">
            A region will be created spanning from{" "}
            <strong>{anchors.find((a) => a.id === anchor1Id)?.name}</strong> to{" "}
            <strong>{anchors.find((a) => a.id === anchor2Id)?.name}</strong>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnchorRegionCreator;
