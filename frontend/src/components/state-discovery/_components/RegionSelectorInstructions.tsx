/**
 * Instructions card for RegionSelector
 */

import React from "react";
import { Card, CardContent } from "@/components/ui/card";

const RegionSelectorInstructions: React.FC = () => {
  return (
    <Card className="bg-blue-50">
      <CardContent className="py-3">
        <p className="text-sm text-text-muted">
          <strong>Select Analysis Region:</strong> Click and drag to draw a
          rectangle around the area you want to analyze. Drag edges or corners
          to resize. Drag inside to move. This speeds up analysis by focusing on
          specific UI areas.
        </p>
      </CardContent>
    </Card>
  );
};

export default RegionSelectorInstructions;
