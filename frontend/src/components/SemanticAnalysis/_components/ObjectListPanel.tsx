"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SemanticObject, SemanticScene } from "@/types/semantic-analysis";
import { typeColors } from "../semantic-analysis-utils";

interface ObjectListPanelProps {
  scene: SemanticScene;
  hoveredObject: string | null;
  onObjectSelect: (obj: SemanticObject) => void;
  onObjectHover: (id: string | null) => void;
}

export function ObjectListPanel({
  scene,
  hoveredObject,
  onObjectSelect,
  onObjectHover,
}: ObjectListPanelProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted mb-3">
        Click on an object in the image to see details
      </p>

      {/* Object List */}
      <div className="space-y-1">
        {scene.objects.map((obj) => (
          <div
            key={obj.id}
            role="button"
            tabIndex={0}
            onClick={() => onObjectSelect(obj)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onObjectSelect(obj);
              }
            }}
            onMouseEnter={() => onObjectHover(obj.id)}
            onMouseLeave={() => onObjectHover(null)}
            className={cn(
              "p-2 rounded border cursor-pointer transition-all",
              hoveredObject === obj.id
                ? "border-brand-primary bg-brand-primary/10"
                : "border-border-default hover:border-border-subtle"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{
                    backgroundColor: typeColors[obj.type] || typeColors.default,
                  }}
                />
                <span className="text-xs capitalize">{obj.type}</span>
                {obj.pixel_mask && (
                  <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                    M
                  </Badge>
                )}
              </div>
              <Badge variant="secondary" className="text-xs">
                {(obj.confidence * 100).toFixed(0)}%
              </Badge>
            </div>
            {obj.ocr_text && (
              <p className="text-xs text-text-muted mt-1 truncate">
                {obj.ocr_text}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
