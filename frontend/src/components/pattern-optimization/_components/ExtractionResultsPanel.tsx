"use client";

import React from "react";
import type {
  ExtractedPattern,
  PatternQuality,
} from "@/types/pattern-optimization";
import { ImageIcon, Edit2, Eraser, Plus } from "lucide-react";
import { getQualityColor } from "../pattern-optimization-utils";

interface ExtractionResultsPanelProps {
  extractedPattern: ExtractedPattern | null;
  patternQuality: PatternQuality | null;
  editMode: "none" | "add" | "remove";
  editedPattern: string | null;
  patternCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cursorPos: { x: number; y: number } | null;
  brushRadius: number;
  onSetEditMode: (mode: "none" | "add" | "remove") => void;
  onResetEditedPattern: () => void;
  onShowStateImageDialog: () => void;
  onPatternEdit: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onPatternMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onPatternMouseLeave: () => void;
}

export const ExtractionResultsPanel: React.FC<ExtractionResultsPanelProps> = ({
  extractedPattern,
  patternQuality,
  editMode,
  editedPattern,
  patternCanvasRef,
  cursorPos,
  brushRadius,
  onSetEditMode,
  onResetEditedPattern,
  onShowStateImageDialog,
  onPatternEdit,
  onPatternMouseMove,
  onPatternMouseLeave,
}) => {
  return (
    <div className="w-80 bg-surface-raised/50 border-l border-border-subtle flex flex-col">
      <div className="p-4 border-b border-border-subtle flex-shrink-0">
        <h2 className="font-semibold text-white">Extraction Results</h2>
      </div>

      <div className="p-4 flex-1 overflow-y-auto">
        {extractedPattern ? (
          <div className="space-y-4">
            {/* Pattern Info */}
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-white">
                  {extractedPattern.name}
                </h3>
                <p className="text-sm text-text-muted">
                  {extractedPattern.width}x{extractedPattern.height} pixels
                </p>
              </div>
              <button
                onClick={onShowStateImageDialog}
                className="px-3 py-1.5 bg-brand-success text-black rounded-md hover:bg-brand-success/90 font-medium text-sm flex items-center gap-1"
                title="Create a StateImage from this pattern"
              >
                <Plus className="w-4 h-4" />
                StateImage
              </button>
            </div>

            {/* Quality Badge */}
            {patternQuality && (
              <div
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border ${getQualityColor(patternQuality.rating)}`}
              >
                {patternQuality.rating.toUpperCase()} ({patternQuality.score}
                /100)
              </div>
            )}

            {/* Pattern Images */}
            <div className="space-y-3">
              {/* Pattern Editing Tools */}
              <EditTransparencyToolbar
                editMode={editMode}
                editedPattern={editedPattern}
                onSetEditMode={onSetEditMode}
                onResetEditedPattern={onResetEditedPattern}
              />

              {/* Pattern Display */}
              <PatternDisplay
                extractedPattern={extractedPattern}
                editMode={editMode}
                editedPattern={editedPattern}
                patternCanvasRef={patternCanvasRef}
                cursorPos={cursorPos}
                brushRadius={brushRadius}
                onPatternEdit={onPatternEdit}
                onPatternMouseMove={onPatternMouseMove}
                onPatternMouseLeave={onPatternMouseLeave}
              />

              {/* Confidence Map & Mask */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <h4
                    className="text-xs font-medium text-text-secondary mb-1 cursor-help"
                    title="Shows pixel consistency across screenshots. Brighter areas (white) indicate high similarity between screenshots - these pixels are stable. Darker areas (black) show high variation - these pixels change between screenshots."
                  >
                    Confidence Map
                  </h4>
                  <div className="border rounded bg-surface-raised p-2">
                    {extractedPattern.confidenceMap ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={extractedPattern.confidenceMap}
                        alt="Confidence"
                        className="w-full h-auto"
                      />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                        No image
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <h4
                    className="text-xs font-medium text-text-secondary mb-1 cursor-help"
                    title="Binary mask showing which pixels are included in the pattern. White pixels are included (confidence above threshold), black pixels are excluded (confidence below threshold or too variable)."
                  >
                    Mask
                  </h4>
                  <div className="border rounded bg-surface-raised p-2">
                    {extractedPattern.maskImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={extractedPattern.maskImage}
                        alt="Mask"
                        className="w-full h-auto"
                      />
                    ) : (
                      <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                        No image
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Color Legend */}
              <div className="text-xs text-text-muted space-y-1 bg-surface-raised rounded p-2">
                <div className="font-medium mb-1">Color Guide:</div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-white border border-border-default rounded"></div>
                  <span>High confidence / Included pixels</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-black rounded"></div>
                  <span>Low confidence / Excluded pixels</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-surface-raised rounded"></div>
                  <span>Medium confidence (Confidence Map only)</span>
                </div>
              </div>

              {/* Statistics */}
              <div className="bg-surface-raised rounded-lg p-3 border border-border-default">
                <h4 className="text-xs font-medium text-text-secondary mb-2">
                  Statistics
                </h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Mask Density:</span>
                    <span className="font-mono text-text-secondary">
                      {(extractedPattern.maskDensity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Active Pixels:</span>
                    <span className="font-mono text-text-secondary">
                      {extractedPattern.activePixels.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Min Confidence:</span>
                    <span className="font-mono text-text-secondary">
                      {(extractedPattern.minConfidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Avg Confidence:</span>
                    <span className="font-mono text-text-secondary">
                      {(extractedPattern.avgConfidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            {(patternQuality?.recommendations?.length ?? 0) > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                <h4 className="text-sm font-medium text-white mb-1">
                  Recommendations
                </h4>
                <ul className="text-xs text-amber-800 space-y-1">
                  {patternQuality?.recommendations?.map((rec, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="text-amber-600">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="mb-3">
              <div className="w-16 h-16 mx-auto bg-surface-raised rounded-full flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-text-muted" />
              </div>
            </div>
            <p className="font-medium text-white">No Pattern Extracted</p>
            <p className="text-sm text-text-muted mt-1">
              Configure settings and extract a pattern
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Internal sub-components (private to this file)                     */
/* ------------------------------------------------------------------ */

interface EditTransparencyToolbarProps {
  editMode: "none" | "add" | "remove";
  editedPattern: string | null;
  onSetEditMode: (mode: "none" | "add" | "remove") => void;
  onResetEditedPattern: () => void;
}

const EditTransparencyToolbar: React.FC<EditTransparencyToolbarProps> = ({
  editMode,
  editedPattern,
  onSetEditMode,
  onResetEditedPattern,
}) => (
  <div className="bg-surface-raised rounded-lg p-3 border border-border-default">
    <h4 className="text-xs font-medium text-text-secondary mb-2">
      Edit Transparency
    </h4>
    <div className="flex gap-2 mb-2">
      <button
        onClick={() => onSetEditMode(editMode === "add" ? "none" : "add")}
        className={`px-2 py-1 text-xs rounded ${
          editMode === "add"
            ? "bg-blue-500 text-white"
            : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
        }`}
        title="Add transparency (make pixels transparent)"
      >
        <Edit2 className="w-3 h-3 inline mr-1" />
        Add
      </button>
      <button
        onClick={() => onSetEditMode(editMode === "remove" ? "none" : "remove")}
        className={`px-2 py-1 text-xs rounded ${
          editMode === "remove"
            ? "bg-green-500 text-white"
            : "bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
        }`}
        title="Remove transparency (make pixels opaque)"
      >
        <Eraser className="w-3 h-3 inline mr-1" />
        Remove
      </button>
      {editedPattern && (
        <button
          onClick={onResetEditedPattern}
          className="px-2 py-1 text-xs rounded bg-surface-raised text-text-secondary hover:bg-surface-raised/80"
          title="Reset to original pattern"
        >
          Reset
        </button>
      )}
    </div>
    <div className="text-xs text-text-muted">
      {editMode === "add" &&
        "Click or drag on the pattern below to add transparency (make areas transparent)"}
      {editMode === "remove" &&
        "Click or drag on the pattern below to remove transparency (make areas opaque)"}
      {editMode === "none" &&
        "Select Add or Remove to edit transparency in the pattern below"}
    </div>
  </div>
);

interface PatternDisplayProps {
  extractedPattern: ExtractedPattern;
  editMode: "none" | "add" | "remove";
  editedPattern: string | null;
  patternCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  cursorPos: { x: number; y: number } | null;
  brushRadius: number;
  onPatternEdit: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onPatternMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onPatternMouseLeave: () => void;
}

const PatternDisplay: React.FC<PatternDisplayProps> = ({
  extractedPattern,
  editMode,
  editedPattern,
  patternCanvasRef,
  cursorPos,
  brushRadius,
  onPatternEdit,
  onPatternMouseMove,
  onPatternMouseLeave,
}) => (
  <div>
    <h4
      className="text-xs font-medium text-text-secondary mb-1 cursor-help"
      title="The final extracted pattern. Only pixels that passed the confidence threshold (shown as white in the mask) are included. Pixels with low confidence (black in mask) are made transparent, creating a pattern that focuses on stable, consistent elements while ignoring variable parts like text or changing UI elements."
    >
      Pattern
    </h4>
    <div className="relative">
      {editMode !== "none" ? (
        // Show editable canvas when in edit mode
        <>
          <canvas
            ref={patternCanvasRef}
            width={extractedPattern.width}
            height={extractedPattern.height}
            className="w-full h-auto border rounded cursor-crosshair"
            onClick={onPatternEdit}
            onMouseMove={onPatternMouseMove}
            onMouseLeave={onPatternMouseLeave}
            style={{
              imageRendering: "pixelated",
              maxHeight: "300px",
              objectFit: "contain",
            }}
          />
          {/* Cursor indicator overlay */}
          {cursorPos &&
            (editMode === "add" || editMode === "remove") &&
            patternCanvasRef.current && (
              <div
                className="absolute pointer-events-none border-2 rounded-full"
                style={{
                  left: `${(cursorPos.x / extractedPattern.width) * 100}%`,
                  top: `${(cursorPos.y / extractedPattern.height) * 100}%`,
                  width: `${(brushRadius * 2 + 1) * (patternCanvasRef.current.getBoundingClientRect().width / extractedPattern.width)}px`,
                  height: `${(brushRadius * 2 + 1) * (patternCanvasRef.current.getBoundingClientRect().height / extractedPattern.height)}px`,
                  transform: "translate(-50%, -50%)",
                  borderColor: editMode === "add" ? "#3b82f6" : "#10b981",
                  opacity: 0.8,
                }}
              />
            )}
        </>
      ) : (
        // Show static pattern when not editing
        <div
          className="border rounded p-2"
          style={{
            background: `
              linear-gradient(45deg, #f3f4f6 25%, transparent 25%),
              linear-gradient(-45deg, #f3f4f6 25%, transparent 25%),
              linear-gradient(45deg, transparent 75%, #f3f4f6 75%),
              linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)
            `,
            backgroundSize: "10px 10px",
            backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
            backgroundColor: "#ffffff",
          }}
        >
          {editedPattern || extractedPattern.patternImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={editedPattern || extractedPattern.patternImage}
              alt="Pattern"
              className="w-full h-auto"
              style={{
                maxHeight: "300px",
                objectFit: "contain",
              }}
            />
          ) : (
            <div className="h-24 flex items-center justify-center text-text-muted text-xs bg-surface-raised rounded">
              No image
            </div>
          )}
        </div>
      )}
    </div>
  </div>
);
