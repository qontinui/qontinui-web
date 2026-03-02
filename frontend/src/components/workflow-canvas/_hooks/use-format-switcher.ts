import { useState, useEffect, useMemo } from "react";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  getFormatConverter,
  ConversionPreview,
  ConversionResult,
} from "@/services/format-converter";
import { LayoutStyle } from "@/lib/workflow-layout/auto-layout";

interface UseFormatSwitcherArgs {
  open: boolean;
  workflow: Workflow;
  currentFormat: "sequential" | "graph";
  onSwitch: (newWorkflow: Workflow, newFormat: "sequential" | "graph") => void;
  onClose: () => void;
}

export function useFormatSwitcher({
  open,
  workflow,
  currentFormat,
  onSwitch,
  onClose,
}: UseFormatSwitcherArgs) {
  const [targetFormat, setTargetFormat] = useState<"sequential" | "graph">(
    currentFormat === "sequential" ? "graph" : "sequential"
  );
  const [viewMode, setViewMode] = useState<"list" | "preview">("list");
  const [selectedLayout, setSelectedLayout] = useState<LayoutStyle>(
    LayoutStyle.HIERARCHICAL
  );
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionPreview, setConversionPreview] =
    useState<ConversionPreview | null>(null);
  const [previewWorkflow, setPreviewWorkflow] = useState<Workflow | null>(null);

  const converter = useMemo(() => getFormatConverter(), []);

  const generatePreviewWorkflow = async () => {
    try {
      let result: ConversionResult;

      if (targetFormat === "graph") {
        result = await converter.convertToGraph(workflow, {
          autoLayout: true,
          layoutStyle: selectedLayout as
            | "tree"
            | "horizontal"
            | "hierarchical"
            | undefined,
          validate: true,
        });
      } else {
        result = await converter.convertToSequential(workflow, {
          validate: true,
        });
      }

      if (result.success && result.workflow) {
        setPreviewWorkflow(result.workflow);
      }
    } catch (err) {
      console.error("Failed to generate preview:", err);
    }
  };

  // Load conversion preview when dialog opens
  useEffect(() => {
    if (open) {
      setError(null);
      setTargetFormat(currentFormat === "sequential" ? "graph" : "sequential");

      const preview = converter.previewConversion(workflow, targetFormat);
      setConversionPreview(preview);

      generatePreviewWorkflow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workflow, currentFormat]);

  // Update preview when target format changes
  useEffect(() => {
    if (open && conversionPreview) {
      const preview = converter.previewConversion(workflow, targetFormat);
      setConversionPreview(preview);
      generatePreviewWorkflow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFormat]);

  const handleConvert = async () => {
    setIsConverting(true);
    setError(null);

    try {
      let result: ConversionResult;

      if (targetFormat === "graph") {
        result = await converter.convertToGraph(workflow, {
          autoLayout: true,
          layoutStyle: selectedLayout as
            | "tree"
            | "horizontal"
            | "hierarchical"
            | undefined,
          validate: true,
        });
      } else {
        result = await converter.convertToSequential(workflow, {
          validate: true,
        });
      }

      if (result.success && result.workflow) {
        onSwitch(result.workflow, targetFormat);
        onClose();
      } else {
        setError(result.errors?.[0]?.message || "Conversion failed");
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Conversion failed";
      setError(errorMessage);
    } finally {
      setIsConverting(false);
    }
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  const canConvert = conversionPreview?.canConvert ?? false;

  return {
    targetFormat,
    setTargetFormat,
    viewMode,
    setViewMode,
    selectedLayout,
    setSelectedLayout,
    isConverting,
    error,
    conversionPreview,
    previewWorkflow,
    canConvert,
    handleConvert,
    handleCancel,
  };
}
