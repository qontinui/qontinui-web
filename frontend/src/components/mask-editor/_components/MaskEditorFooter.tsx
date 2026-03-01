"use client";

import React from "react";

export const MaskEditorFooter: React.FC = () => {
  return (
    <div className="bg-surface-raised p-2 text-xs text-text-muted shrink-0">
      <ul className="list-disc list-inside space-y-1">
        <li>
          <strong className="text-text-secondary">Result:</strong> Draw on this
          canvas to edit the mask (shows final image with transparency)
        </li>
        <li>
          <strong className="text-text-secondary">Original:</strong> Unmodified
          source image
        </li>
        <li>
          <strong className="text-text-secondary">Mask:</strong> Visual
          representation of the mask (white = visible, black = transparent)
        </li>
        <li>
          <strong className="text-text-secondary">Brush:</strong> Add pixels to
          mask (make areas visible)
        </li>
        <li>
          <strong className="text-text-secondary">Eraser:</strong> Remove pixels
          from mask (make areas transparent)
        </li>
        <li>
          <strong className="text-text-secondary">Undo/Redo:</strong> Navigate
          through last 10 changes
        </li>
        <li>
          <strong className="text-text-secondary">Remove Background:</strong>{" "}
          Automatically detect and remove background (samples edge colors)
        </li>
        <li>
          <strong className="text-text-secondary">Remove Border:</strong>{" "}
          Automatically detect and remove border pixels
        </li>
        <li>
          <strong className="text-text-secondary">Removal Tolerance:</strong>{" "}
          Adjust color matching sensitivity (0-50, default: 10)
        </li>
      </ul>
    </div>
  );
};
