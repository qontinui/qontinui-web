/**
 * Simple test page for RegionSelector component
 */

import React, { useState } from "react";
import RegionSelector from "./RegionSelector";

const TestRegionSelector: React.FC = () => {
  const [selectedRegion, setSelectedRegion] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Create a test image URL (data URL for a simple colored rectangle)
  const createTestImage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Fill with gradient
      const gradient = ctx.createLinearGradient(0, 0, 800, 600);
      gradient.addColorStop(0, "#4A90E2");
      gradient.addColorStop(1, "#7B68EE");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 800, 600);

      // Add some rectangles to make it more interesting
      ctx.fillStyle = "#FF6B6B";
      ctx.fillRect(100, 100, 200, 150);

      ctx.fillStyle = "#4ECDC4";
      ctx.fillRect(500, 350, 200, 150);

      ctx.fillStyle = "#45B7D1";
      ctx.fillRect(300, 250, 150, 100);
    }
    return canvas.toDataURL();
  };

  const testImageUrl = createTestImage();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Region Selector Test</h1>

      <div className="mb-4">
        {selectedRegion ? (
          <div className="p-3 bg-green-100 rounded">
            <strong>Selected Region:</strong>
            Position: ({selectedRegion.x}, {selectedRegion.y}), Size:{" "}
            {selectedRegion.width} × {selectedRegion.height}
          </div>
        ) : (
          <div className="p-3 bg-gray-100 rounded">
            No region selected. Click and drag on the image below to select a
            region.
          </div>
        )}
      </div>

      <RegionSelector
        imageUrl={testImageUrl}
        imageWidth={800}
        imageHeight={600}
        onRegionSelect={(region) => {
          console.log("Region selected:", region);
          setSelectedRegion(region);
        }}
        initialRegion={selectedRegion}
      />
    </div>
  );
};

export default TestRegionSelector;
