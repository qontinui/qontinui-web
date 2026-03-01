"use client";

import React, { useRef } from "react";
import { RefreshCw, Info } from "lucide-react";
import { useSemanticAnalysisBridge } from "@/stores/page-state";

import { useProcessingOptions } from "./_hooks/use-processing-options";
import { useDisplayOptions } from "./_hooks/use-display-options";
import { useCanvasViewport } from "./_hooks/use-canvas-viewport";
import { useImageAnalysis } from "./_hooks/use-image-analysis";

import { ImageUploadCard } from "./_components/ImageUploadCard";
import { ProcessingOptionsCard } from "./_components/ProcessingOptionsCard";
import { DisplayOptionsCard } from "./_components/DisplayOptionsCard";
import { AnalysisResultsCard } from "./_components/AnalysisResultsCard";
import { CanvasToolbar } from "./_components/CanvasToolbar";
import { AnalysisCanvas } from "./_components/AnalysisCanvas";
import { ObjectDetailPanel } from "./_components/ObjectDetailPanel";
import { ObjectListPanel } from "./_components/ObjectListPanel";

export function SemanticAnalysisTab() {
  // Persistent state from store
  const { isHydrating } = useSemanticAnalysisBridge();

  // Local UI state grouped into logical hooks
  const processingOptions = useProcessingOptions();
  const displayOptions = useDisplayOptions();
  const viewport = useCanvasViewport();
  const imageAnalysis = useImageAnalysis(processingOptions);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Show loading state during hydration
  if (isHydrating) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-canvas">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 text-text-muted animate-spin" />
          <p className="text-sm text-text-muted">Loading page state...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-surface-canvas">
      {/* Left Panel - Controls */}
      <div className="w-80 border-r border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
        <div className="space-y-4">
          <ImageUploadCard
            selectedImage={imageAnalysis.selectedImage}
            fileInputRef={imageAnalysis.fileInputRef}
            onImageUpload={imageAnalysis.handleImageUpload}
          />

          <ProcessingOptionsCard
            options={processingOptions}
            selectedImage={imageAnalysis.selectedImage}
            processing={imageAnalysis.processing}
            onProcessImage={imageAnalysis.processImage}
          />

          <DisplayOptionsCard options={displayOptions} />

          {imageAnalysis.scene && (
            <AnalysisResultsCard scene={imageAnalysis.scene} />
          )}
        </div>
      </div>

      {/* Center - Canvas */}
      <div className="flex-1 flex flex-col">
        <CanvasToolbar viewport={viewport} />
        <AnalysisCanvas
          selectedImage={imageAnalysis.selectedImage}
          scene={imageAnalysis.scene}
          selectedObject={imageAnalysis.selectedObject}
          hoveredObject={imageAnalysis.hoveredObject}
          showLabels={displayOptions.showLabels}
          showBoundingBoxes={displayOptions.showBoundingBoxes}
          showMasks={displayOptions.showMasks}
          viewport={viewport}
          onObjectSelect={imageAnalysis.setSelectedObject}
          onObjectHover={imageAnalysis.setHoveredObject}
          canvasRef={canvasRef}
        />
      </div>

      {/* Right Panel - Object Details */}
      <div className="w-96 border-l border-border-subtle bg-surface-raised/50 p-4 overflow-y-auto">
        <h3 className="text-sm font-medium mb-4">Object Details</h3>

        {imageAnalysis.selectedObject ? (
          <ObjectDetailPanel
            selectedObject={imageAnalysis.selectedObject}
            canvasRef={canvasRef}
            zoom={viewport.zoom}
            onCenterObject={viewport.setPanOffset}
          />
        ) : imageAnalysis.scene ? (
          <ObjectListPanel
            scene={imageAnalysis.scene}
            hoveredObject={imageAnalysis.hoveredObject}
            onObjectSelect={imageAnalysis.setSelectedObject}
            onObjectHover={imageAnalysis.setHoveredObject}
          />
        ) : (
          <div className="text-center">
            <Info className="w-8 h-8 mx-auto mb-2 text-text-muted" />
            <p className="text-xs text-text-muted">
              Process an image to see detected objects
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
