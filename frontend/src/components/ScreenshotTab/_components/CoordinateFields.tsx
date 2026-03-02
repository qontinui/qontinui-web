import React from "react";
import { ScreenshotLocation } from "../../../types/Screenshot";

interface CoordinateFieldsProps {
  location: ScreenshotLocation;
  onCoordinateChange: (axis: "x" | "y", value: number) => void;
}

const CoordinateFields: React.FC<CoordinateFieldsProps> = ({
  location,
  onCoordinateChange,
}) => {
  const isDisabled = !!(
    location.referenceImageId && location.referenceImageId !== "pending"
  );

  return (
    <div>
      <p className="block text-sm font-medium text-text-secondary mb-1">
        Position
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="lpp-x" className="block text-xs text-text-muted">
            X
          </label>
          <input
            id="lpp-x"
            type="number"
            value={location.x}
            onChange={(e) => onCoordinateChange("x", Number(e.target.value))}
            disabled={isDisabled}
            className={`w-full px-2 py-1 border border-border-default rounded text-sm ${
              isDisabled
                ? "bg-surface-raised text-text-muted cursor-not-allowed"
                : "text-text-primary"
            }`}
          />
        </div>
        <div>
          <label htmlFor="lpp-y" className="block text-xs text-text-muted">
            Y
          </label>
          <input
            id="lpp-y"
            type="number"
            value={location.y}
            onChange={(e) => onCoordinateChange("y", Number(e.target.value))}
            disabled={isDisabled}
            className={`w-full px-2 py-1 border border-border-default rounded text-sm ${
              isDisabled
                ? "bg-surface-raised text-text-muted cursor-not-allowed"
                : "text-text-primary"
            }`}
          />
        </div>
      </div>
    </div>
  );
};

export default CoordinateFields;
