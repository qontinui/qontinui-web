/**
 * Conversion Wizard
 *
 * Multi-step wizard for format conversion.
 * Steps:
 * 1. Format Selection - Choose target format
 * 2. Validation - Linearizability check (conditional)
 * 3. Layout Selection - Choose layout style (conditional)
 * 4. Preview Changes - Show before/after
 * 5. Confirm - Apply conversion
 */

import React, { useState, useEffect } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getFormatConverter,
  ConversionPreview,
  ConversionResult,
} from "@/services/format-converter";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";
import { ConversionPreview as ConversionPreviewComponent } from "./ConversionPreview";

// ============================================================================
// Types
// ============================================================================

export interface ConversionWizardProps {
  open: boolean;
  workflow: Workflow;
  currentFormat: "sequential" | "graph";
  onComplete: (workflow: Workflow, format: "sequential" | "graph") => void;
  onCancel: () => void;
}

type WizardStep = "format" | "validation" | "layout" | "preview" | "confirm";

// ============================================================================
// Conversion Wizard Component
// ============================================================================

export function ConversionWizard({
  open,
  workflow,
  currentFormat,
  onComplete,
  onCancel,
}: ConversionWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("format");
  const [targetFormat, setTargetFormat] = useState<"sequential" | "graph">(
    currentFormat === "sequential" ? "graph" : "sequential"
  );
  const [selectedLayout, setSelectedLayout] = useState<LayoutStyle>(
    LayoutStyle.HIERARCHICAL
  );
  const [conversionPreview, setConversionPreview] =
    useState<ConversionPreview | null>(null);
  const [previewWorkflow, setPreviewWorkflow] = useState<Workflow | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const converter = getFormatConverter();

  useEffect(() => {
    if (open) {
      setCurrentStep("format");
      setTargetFormat(currentFormat === "sequential" ? "graph" : "sequential");
      setError(null);
    }
  }, [open, currentFormat]);

  useEffect(() => {
    if (targetFormat) {
      const preview = converter.previewConversion(workflow, targetFormat);
      setConversionPreview(preview);
    }
  }, [targetFormat, workflow]);

  const canProceed = () => {
    if (currentStep === "format") return targetFormat !== currentFormat;
    if (currentStep === "validation")
      return conversionPreview?.canConvert ?? false;
    return true;
  };

  const handleNext = async () => {
    switch (currentStep) {
      case "format":
        // Check if validation is needed
        if (targetFormat === "sequential") {
          setCurrentStep("validation");
        } else if (targetFormat === "graph") {
          setCurrentStep("layout");
        }
        break;

      case "validation":
        setCurrentStep("preview");
        await generatePreview();
        break;

      case "layout":
        setCurrentStep("preview");
        await generatePreview();
        break;

      case "preview":
        setCurrentStep("confirm");
        break;

      case "confirm":
        await handleConvert();
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case "validation":
      case "layout":
        setCurrentStep("format");
        break;
      case "preview":
        if (targetFormat === "sequential") {
          setCurrentStep("validation");
        } else {
          setCurrentStep("layout");
        }
        break;
      case "confirm":
        setCurrentStep("preview");
        break;
    }
  };

  const generatePreview = async () => {
    try {
      let result: ConversionResult;

      if (targetFormat === "graph") {
        result = await converter.convertToGraph(workflow, {
          autoLayout: true,
          layoutStyle: selectedLayout,
          validate: true,
        });
      } else {
        result = await converter.convertToSequential(workflow, {
          validate: true,
        });
      }

      if (result.success && result.workflow) {
        setPreviewWorkflow(result.workflow);
      } else {
        setError(result.errors?.[0]?.message || "Failed to generate preview");
      }
    } catch (err: any) {
      setError(err.message || "Failed to generate preview");
    }
  };

  const handleConvert = async () => {
    setIsConverting(true);
    setError(null);

    try {
      if (previewWorkflow) {
        onComplete(previewWorkflow, targetFormat);
      }
    } catch (err: any) {
      setError(err.message || "Conversion failed");
    } finally {
      setIsConverting(false);
    }
  };

  if (!open) return null;

  const steps: WizardStep[] = ["format"];
  if (targetFormat === "sequential") steps.push("validation");
  if (targetFormat === "graph") steps.push("layout");
  steps.push("preview", "confirm");

  const currentStepIndex = steps.indexOf(currentStep);

  return (
    <div className="conversion-wizard-overlay">
      <div className="conversion-wizard">
        <div className="wizard-header">
          <h2>Convert Workflow Format</h2>
          <button className="close-button" onClick={onCancel}>
            ×
          </button>
        </div>

        {/* Progress Bar */}
        <div className="wizard-progress">
          {steps.map((step, index) => (
            <div
              key={step}
              className={`progress-step ${index <= currentStepIndex ? "active" : ""} ${index === currentStepIndex ? "current" : ""}`}
            >
              <div className="step-number">{index + 1}</div>
              <div className="step-label">{getStepLabel(step)}</div>
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="wizard-content">
          {currentStep === "format" && (
            <FormatSelectionStep
              currentFormat={currentFormat}
              targetFormat={targetFormat}
              onSelectFormat={setTargetFormat}
            />
          )}

          {currentStep === "validation" && conversionPreview && (
            <ValidationStep conversionPreview={conversionPreview} />
          )}

          {currentStep === "layout" && (
            <LayoutSelectionStep
              selectedLayout={selectedLayout}
              onSelectLayout={setSelectedLayout}
            />
          )}

          {currentStep === "preview" &&
            previewWorkflow &&
            conversionPreview && (
              <PreviewStep
                beforeWorkflow={workflow}
                afterWorkflow={previewWorkflow}
                conversionPreview={conversionPreview}
              />
            )}

          {currentStep === "confirm" && (
            <ConfirmStep
              conversionPreview={conversionPreview!}
              isConverting={isConverting}
            />
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="wizard-error">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Navigation */}
        <div className="wizard-footer">
          <button
            className="back-button"
            onClick={handleBack}
            disabled={currentStepIndex === 0 || isConverting}
          >
            Back
          </button>
          <button
            className="next-button"
            onClick={handleNext}
            disabled={!canProceed() || isConverting}
          >
            {currentStep === "confirm"
              ? isConverting
                ? "Converting..."
                : "Convert"
              : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step Components
// ============================================================================

function FormatSelectionStep({
  currentFormat,
  targetFormat,
  onSelectFormat,
}: {
  currentFormat: string;
  targetFormat: string;
  onSelectFormat: (format: "sequential" | "graph") => void;
}) {
  return (
    <div className="format-selection-step">
      <h3>Select Target Format</h3>
      <div className="format-options">
        <button
          className={`format-option ${targetFormat === "sequential" ? "selected" : ""}`}
          onClick={() => onSelectFormat("sequential")}
          disabled={currentFormat === "sequential"}
        >
          <div className="format-icon">📋</div>
          <h4>Sequential</h4>
          <p>Actions execute in order</p>
        </button>
        <button
          className={`format-option ${targetFormat === "graph" ? "selected" : ""}`}
          onClick={() => onSelectFormat("graph")}
          disabled={currentFormat === "graph"}
        >
          <div className="format-icon">🕸️</div>
          <h4>Graph</h4>
          <p>Flexible flow control</p>
        </button>
      </div>
    </div>
  );
}

function ValidationStep({
  conversionPreview,
}: {
  conversionPreview: ConversionPreview;
}) {
  const linearizability = conversionPreview.linearizability!;

  return (
    <div className="validation-step">
      <h3>Validation Check</h3>
      <div
        className={`validation-result ${linearizability.linearizable ? "success" : "error"}`}
      >
        {linearizability.linearizable ? (
          <>
            <div className="result-icon">✓</div>
            <h4>Workflow can be converted</h4>
            <p>
              This workflow can be successfully converted to sequential format
            </p>
          </>
        ) : (
          <>
            <div className="result-icon">✗</div>
            <h4>Workflow cannot be converted</h4>
            <p>This workflow has structures that cannot be linearized</p>
            <ul className="issues-list">
              {linearizability.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function LayoutSelectionStep({
  selectedLayout,
  onSelectLayout,
}: {
  selectedLayout: LayoutStyle;
  onSelectLayout: (style: LayoutStyle) => void;
}) {
  return (
    <div className="layout-selection-step">
      <h3>Choose Layout Style</h3>
      <div className="layout-options">
        {Object.values(LayoutStyle).map((style) => (
          <button
            key={style}
            className={`layout-option ${selectedLayout === style ? "selected" : ""}`}
            onClick={() => onSelectLayout(style)}
          >
            <h4>{style}</h4>
          </button>
        ))}
      </div>
    </div>
  );
}

function PreviewStep({
  beforeWorkflow,
  afterWorkflow,
  conversionPreview,
}: {
  beforeWorkflow: Workflow;
  afterWorkflow: Workflow;
  conversionPreview: ConversionPreview;
}) {
  return (
    <div className="preview-step">
      <h3>Preview Changes</h3>
      <ConversionPreviewComponent
        beforeWorkflow={beforeWorkflow}
        afterWorkflow={afterWorkflow}
        conversionPreview={conversionPreview}
      />
    </div>
  );
}

function ConfirmStep({
  conversionPreview,
  isConverting,
}: {
  conversionPreview: ConversionPreview;
  isConverting: boolean;
}) {
  return (
    <div className="confirm-step">
      <h3>Ready to Convert</h3>
      {isConverting ? (
        <div className="converting-message">
          <div className="spinner" />
          <p>Converting workflow...</p>
        </div>
      ) : (
        <>
          <p>Click "Convert" to apply the changes to your workflow.</p>
          <div className="conversion-summary">
            <div className="summary-item">
              <strong>Target Format:</strong> {conversionPreview.toFormat}
            </div>
            <div className="summary-item">
              <strong>Impact:</strong> {conversionPreview.impact}
            </div>
            <div className="summary-item">
              <strong>Recommendation:</strong>{" "}
              {conversionPreview.recommendation}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function getStepLabel(step: WizardStep): string {
  switch (step) {
    case "format":
      return "Format";
    case "validation":
      return "Validation";
    case "layout":
      return "Layout";
    case "preview":
      return "Preview";
    case "confirm":
      return "Confirm";
  }
}
