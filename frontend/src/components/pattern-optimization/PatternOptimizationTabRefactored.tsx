import React from "react";
import { useMaskedPatterns } from "./_hooks/useMaskedPatterns";
import { PatternListItem } from "./_components/PatternListItem";
import { ExtractionForm } from "./_components/ExtractionForm";
import { PatternDetailPanel } from "./_components/PatternDetailPanel";
import { EmptyPatternState } from "./_components/EmptyPatternState";

export const PatternOptimizationTabRefactored: React.FC = () => {
  const {
    patterns,
    selectedPattern,
    setSelectedPattern,
    stateImages,
    selectedStateImage,
    setSelectedStateImage,
    extractionConfig,
    setExtractionConfig,
    isExtracting,
    patternName,
    setPatternName,
    extractMaskedPattern,
    updatePatternThreshold,
    analyzePatternQuality,
  } = useMaskedPatterns();

  return (
    <div className="pattern-optimization-tab-refactored p-4">
      <div className="grid grid-cols-12 gap-4">
        {/* Pattern List */}
        <div className="col-span-3 bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-3">Masked Patterns</h2>

          <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
            {patterns.map((pattern) => (
              <PatternListItem
                key={pattern.id}
                pattern={pattern}
                isSelected={selectedPattern?.id === pattern.id}
                analysis={analyzePatternQuality(pattern)}
                onSelect={setSelectedPattern}
              />
            ))}
          </div>

          <ExtractionForm
            stateImages={stateImages}
            selectedStateImage={selectedStateImage}
            onSelectStateImage={setSelectedStateImage}
            patternName={patternName}
            onPatternNameChange={setPatternName}
            extractionConfig={extractionConfig}
            onExtractionConfigChange={setExtractionConfig}
            isExtracting={isExtracting}
            onExtract={extractMaskedPattern}
          />
        </div>

        {/* Pattern Details and Visualization */}
        <div className="col-span-9 bg-white rounded-lg shadow p-4">
          {selectedPattern ? (
            <PatternDetailPanel
              pattern={selectedPattern}
              analysis={analyzePatternQuality(selectedPattern)}
              onUpdateThreshold={updatePatternThreshold}
            />
          ) : (
            <EmptyPatternState />
          )}
        </div>
      </div>

      {/* CSS for checkerboard background */}
      <style>{`
        .bg-checkerboard {
          background-image:
            linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
            linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
          background-size: 20px 20px;
          background-position:
            0 0,
            0 10px,
            10px -10px,
            -10px 0px;
        }
      `}</style>
    </div>
  );
};
