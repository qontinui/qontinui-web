import React from "react";

interface CanvasInfoProps {
  stateName: string;
  width: number;
  height: number;
}

export function CanvasInfo({ stateName, width, height }: CanvasInfoProps) {
  return (
    <div className="absolute top-4 left-4 z-10 bg-background/90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
      <div className="text-sm font-medium">{stateName}</div>
      <div className="text-xs text-muted-foreground">
        {width} × {height}
      </div>
    </div>
  );
}
