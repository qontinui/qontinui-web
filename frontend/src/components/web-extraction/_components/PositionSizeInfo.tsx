"use client";

import { MapPin } from "lucide-react";
import type { BoundingBox } from "../state-image-modal-types";

interface PositionSizeInfoProps {
  bbox: BoundingBox;
}

export function PositionSizeInfo({ bbox }: PositionSizeInfoProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium flex items-center gap-1.5">
        <MapPin className="h-3.5 w-3.5" />
        Position & Size
      </h4>
      <div className="grid grid-cols-4 gap-1.5 text-xs">
        <div className="bg-muted rounded px-2 py-1">
          <span className="text-muted-foreground">X:</span> {bbox.x}
        </div>
        <div className="bg-muted rounded px-2 py-1">
          <span className="text-muted-foreground">Y:</span> {bbox.y}
        </div>
        <div className="bg-muted rounded px-2 py-1">
          <span className="text-muted-foreground">W:</span> {bbox.width}
        </div>
        <div className="bg-muted rounded px-2 py-1">
          <span className="text-muted-foreground">H:</span> {bbox.height}
        </div>
      </div>
    </div>
  );
}
