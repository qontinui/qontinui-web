"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { SemanticObject } from "@/types/semantic-analysis";
import { getTypeColor } from "../semantic-analysis-utils";

interface ObjectDetailPanelProps {
  selectedObject: SemanticObject;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  zoom: number;
  onCenterObject: (panOffset: { x: number; y: number }) => void;
}

export function ObjectDetailPanel({
  selectedObject,
  canvasRef,
  zoom,
  onCenterObject,
}: ObjectDetailPanelProps) {
  const color = getTypeColor(selectedObject.type);

  return (
    <div className="space-y-4">
      <Card className="bg-surface-raised/50 border-border-default">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span>{selectedObject.type.toUpperCase()}</span>
            <Badge style={{ backgroundColor: color }}>
              {(selectedObject.confidence * 100).toFixed(0)}%
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-text-muted">Description</Label>
            <p className="text-sm mt-1">{selectedObject.description}</p>
          </div>

          {selectedObject.ocr_text && (
            <div>
              <Label className="text-xs text-text-muted">OCR Text</Label>
              <p className="text-sm mt-1 font-mono">
                {selectedObject.ocr_text}
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs text-text-muted">Position</Label>
            <p className="text-xs mt-1 font-mono">
              x: {selectedObject.bounding_box.x}, y:{" "}
              {selectedObject.bounding_box.y}
            </p>
            <p className="text-xs font-mono">
              w: {selectedObject.bounding_box.width}, h:{" "}
              {selectedObject.bounding_box.height}
            </p>
          </div>

          <div>
            <Label className="text-xs text-text-muted">Attributes</Label>
            <div className="mt-1 space-y-1">
              {Object.entries(selectedObject.attributes).map(([key, value]) => (
                <div key={key} className="flex justify-between text-xs">
                  <span className="text-text-muted">{key}:</span>
                  <span
                    className={
                      key === "has_mask" && value ? "text-brand-success" : ""
                    }
                  >
                    {typeof value === "object"
                      ? JSON.stringify(value)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {selectedObject.pixel_mask && (
            <div className="pt-3 border-t border-border-default">
              <Label className="text-xs text-text-muted">
                Mask Information
              </Label>
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-brand-success"></div>
                  <span className="text-xs">Pixel mask available</span>
                </div>
                <div className="text-xs text-text-muted">
                  Mask size: {selectedObject.bounding_box.width} x{" "}
                  {selectedObject.bounding_box.height}
                </div>
                <div className="text-xs text-text-muted">
                  Area:{" "}
                  {(selectedObject.attributes as { area?: number }).area ||
                    selectedObject.bounding_box.width *
                      selectedObject.bounding_box.height}{" "}
                  px
                </div>
              </div>
            </div>
          )}

          <div className="pt-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs"
              onClick={() => {
                if (canvasRef.current) {
                  const rect = canvasRef.current.getBoundingClientRect();
                  const x =
                    selectedObject.bounding_box.x +
                    selectedObject.bounding_box.width / 2;
                  const y =
                    selectedObject.bounding_box.y +
                    selectedObject.bounding_box.height / 2;

                  onCenterObject({
                    x: -x + rect.width / (2 * zoom),
                    y: -y + rect.height / (2 * zoom),
                  });
                }
              }}
            >
              Center in View
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
