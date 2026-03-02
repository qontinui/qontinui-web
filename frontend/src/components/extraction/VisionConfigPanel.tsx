"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { VisionExtractionConfig } from "@/types/extraction-unified";
import { useVisionConfig } from "./_hooks/useVisionConfig";
import { SourceSelectionCard } from "./_components/SourceSelectionCard";
import { DetectionMethodsCard } from "./_components/DetectionMethodsCard";
import { AdvancedSettingsCard } from "./_components/AdvancedSettingsCard";
import { VisionInfoAlert } from "./_components/VisionInfoAlert";

interface VisionConfigPanelProps {
  config: VisionExtractionConfig;
  onConfigChange: (config: VisionExtractionConfig) => void;
}

export function VisionConfigPanel({
  config,
  onConfigChange,
}: VisionConfigPanelProps) {
  const {
    updateConfig,
    updateEdgeDetection,
    updateSam3,
    updateOcr,
    updateFusion,
  } = useVisionConfig(config, onConfigChange);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <SourceSelectionCard config={config} updateConfig={updateConfig} />

        <DetectionMethodsCard
          config={config}
          updateEdgeDetection={updateEdgeDetection}
          updateSam3={updateSam3}
          updateOcr={updateOcr}
        />

        <AdvancedSettingsCard
          config={config}
          updateEdgeDetection={updateEdgeDetection}
          updateSam3={updateSam3}
          updateFusion={updateFusion}
        />

        <VisionInfoAlert sam3Enabled={config.sam3.enabled} />
      </div>
    </TooltipProvider>
  );
}
