import React from "react";
import { ScreenshotLocation, AnchorType } from "../../../types/Screenshot";

interface AnchorSectionProps {
  location: ScreenshotLocation;
  onAnchorToggle: (checked: boolean) => void;
  onAnchorPositionChange: (anchorType: AnchorType) => void;
}

const AnchorSection: React.FC<AnchorSectionProps> = ({
  location,
  onAnchorToggle,
  onAnchorPositionChange,
}) => (
  <div className="space-y-2">
    <label className="flex items-center space-x-2 cursor-pointer p-2 bg-surface-raised rounded hover:bg-surface-raised/80">
      <input
        type="checkbox"
        checked={location.anchor || false}
        onChange={(e) => onAnchorToggle(e.target.checked)}
        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
      />
      <span className="text-sm text-text-secondary font-medium">
        Anchor (for region definition)
      </span>
    </label>

    {location.anchor && (
      <div className="pl-6">
        <label
          htmlFor="lpp-anchor-pos"
          className="block text-xs text-text-muted mb-1"
        >
          Anchor Position
        </label>
        <select
          id="lpp-anchor-pos"
          value={location.anchorType || "CENTER"}
          onChange={(e) => onAnchorPositionChange(e.target.value as AnchorType)}
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
        <p className="text-xs text-text-muted mt-1">
          Specifies which point of a region this location represents
        </p>
      </div>
    )}
  </div>
);

export default AnchorSection;
