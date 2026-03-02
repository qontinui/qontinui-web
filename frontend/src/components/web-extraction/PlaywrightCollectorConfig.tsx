"use client";

import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  usePlaywrightExtractionConfig,
  type PlaywrightExtractionConfigState,
} from "@/hooks/use-playwright-extraction";
import { PlaywrightCollectorSkeleton } from "./_components/PlaywrightCollectorSkeleton";
import { TargetUrlCard } from "./_components/TargetUrlCard";
import { ExtractionOptionsCard } from "./_components/ExtractionOptionsCard";
import { SafetyConfigCard } from "./_components/SafetyConfigCard";

export type PlaywrightCollectorConfigState = PlaywrightExtractionConfigState;

interface PlaywrightCollectorConfigProps {
  onStartExtraction: (config: PlaywrightCollectorConfigState) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function PlaywrightCollectorConfig({
  onStartExtraction,
  isLoading = false,
  disabled = false,
}: PlaywrightCollectorConfigProps) {
  const { config, updateConfig, isLoaded } = usePlaywrightExtractionConfig();

  if (!isLoaded) {
    return <PlaywrightCollectorSkeleton />;
  }

  const handleStartExtraction = () => {
    if (!config.url.trim()) return;
    onStartExtraction(config);
  };

  return (
    <div className="space-y-4 pb-6">
      <TargetUrlCard
        url={config.url}
        onUrlChange={(url) => updateConfig({ url })}
        isValidUrl={isValidUrl}
      />

      <ExtractionOptionsCard config={config} updateConfig={updateConfig} />

      <SafetyConfigCard config={config} updateConfig={updateConfig} />

      <Button
        className="w-full"
        size="lg"
        onClick={handleStartExtraction}
        disabled={
          disabled || isLoading || !config.url.trim() || !isValidUrl(config.url)
        }
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Extracting...
          </>
        ) : (
          <>
            <Play className="h-4 w-4 mr-2" />
            Start State Collection
          </>
        )}
      </Button>

      {config.maxRiskLevel !== "dry_run" && (
        <p className="text-xs text-yellow-500 text-center">
          Warning: The collector will click on elements. Use &quot;Dry Run&quot;
          mode for safe exploration.
        </p>
      )}
    </div>
  );
}
