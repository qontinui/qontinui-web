import React from "react";
import { MaskedPattern, PatternQualityAnalysis } from "../types";

interface PatternListItemProps {
  pattern: MaskedPattern;
  isSelected: boolean;
  analysis: PatternQualityAnalysis;
  onSelect: (pattern: MaskedPattern) => void;
}

export const PatternListItem: React.FC<PatternListItemProps> = ({
  pattern,
  isSelected,
  analysis,
  onSelect,
}) => (
  <div
    onClick={() => onSelect(pattern)}
    className={`p-3 border rounded-lg cursor-pointer hover:bg-surface-raised/80 transition-colors ${
      isSelected ? "border-blue-500 bg-blue-50" : "border-border-default"
    }`}
  >
    <div className="font-medium text-sm">{pattern.name}</div>
    <div className="text-xs text-text-muted mt-1">
      {pattern.width}×{pattern.height} • Density:{" "}
      {(pattern.maskDensity * 100).toFixed(1)}%
    </div>
    <div className="flex justify-between items-center mt-1">
      <span className={`text-xs font-medium ${analysis.qualityColor}`}>
        {analysis.quality}
      </span>
      <span className="text-xs text-text-muted">
        θ={pattern.similarityThreshold.toFixed(2)}
      </span>
    </div>
    <div className="mt-1">
      <div className="h-1 bg-surface-raised rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-400 to-green-500"
          style={{ width: `${pattern.avgConfidence * 100}%` }}
        />
      </div>
    </div>
  </div>
);
