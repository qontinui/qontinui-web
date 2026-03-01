"use client";

import { useState } from "react";
import { Chrome, Globe, Monitor, Smartphone } from "lucide-react";
import type { TargetType } from "@/hooks/useUIBridgeExploration";
import type { TargetTypeRequirement } from "./exploration-config-types";
import {
  computeProgressPercent,
  canStartExploration,
  getStartDisabledReason,
} from "./exploration-config-utils";
import { ControlButtons } from "./_components/ControlButtons";
import { RequirementsInfo } from "./_components/RequirementsInfo";
import { ProgressSection } from "./_components/ProgressSection";
import { RunnerConfigSection } from "./_components/RunnerConfigSection";
import { TargetAppConfigSection } from "./_components/TargetAppConfigSection";
import { LimitsConfigSection } from "./_components/LimitsConfigSection";
import { TimingConfigSection } from "./_components/TimingConfigSection";
import { SafetyConfigSection } from "./_components/SafetyConfigSection";
import type { ExplorationConfigPanelProps } from "./exploration-config-types";
import { DEFAULT_BROWSER_TABS } from "./exploration-config-types";

const TARGET_TYPE_REQUIREMENTS: Record<TargetType, TargetTypeRequirement> = {
  extension: {
    title: "Browser Extension (Recommended)",
    icon: <Chrome className="h-4 w-4" />,
    recommended: true,
    requirements: [
      "Qontinui DevTools extension must be installed in Chrome",
      "Extension must be connected to the runner (check popup)",
      "Target page should have elements with data-ui-id attributes",
    ],
  },
  web: {
    title: "Web Application (Direct HTTP)",
    icon: <Globe className="h-4 w-4" />,
    requirements: [
      "Target app must expose UI Bridge server endpoints",
      "Requires custom server-side element synchronization",
      "Use Browser Extension for most web apps instead",
    ],
  },
  desktop: {
    title: "Desktop App",
    icon: <Monitor className="h-4 w-4" />,
    requirements: [
      "Desktop app must be running (Electron, Tauri, etc.)",
      "UI Bridge SDK must be installed in the frontend",
      "App must connect to qontinui-runner via WebSocket",
    ],
  },
  mobile: {
    title: "Mobile (React Native)",
    icon: <Smartphone className="h-4 w-4" />,
    requirements: [
      "React Native app must be running",
      "UI Bridge SDK must be installed",
      "App must connect to qontinui-runner via WebSocket",
    ],
  },
};

export function ExplorationConfigPanel({
  config,
  onConfigChange,
  progress,
  isRunning,
  onStart,
  onStop,
  connections,
  connectionsLoading,
  selectedConnectionId,
  onConnectionChange,
  browserTabs = DEFAULT_BROWSER_TABS,
  browserTabsLoading = false,
  browserTabsError = null,
  onRefreshBrowserTabs,
  onSelectBrowserTab,
  hideRunnerSection = false,
}: ExplorationConfigPanelProps) {
  const [isRequirementsOpen, setIsRequirementsOpen] = useState(false);

  const progressPercent = computeProgressPercent(progress, config);
  const canStart = canStartExploration(config, selectedConnectionId);
  const disabledReason = getStartDisabledReason(config, selectedConnectionId);

  const currentTargetType = config.targetType || "web";
  const currentRequirements =
    TARGET_TYPE_REQUIREMENTS[currentTargetType as TargetType];

  return (
    <div className="space-y-4">
      <ControlButtons
        isRunning={isRunning}
        canStart={canStart}
        disabledReason={disabledReason}
        progressStatus={progress.status}
        onStart={onStart}
        onStop={onStop}
      />

      <RequirementsInfo
        isOpen={isRequirementsOpen}
        onOpenChange={setIsRequirementsOpen}
        currentRequirements={currentRequirements}
      />

      <ProgressSection
        progress={progress}
        progressPercent={progressPercent}
        isRunning={isRunning}
      />

      {!hideRunnerSection && (
        <RunnerConfigSection
          targetType={config.targetType}
          connections={connections}
          connectionsLoading={connectionsLoading}
          selectedConnectionId={selectedConnectionId}
          onConnectionChange={onConnectionChange}
          isRunning={isRunning}
        />
      )}

      <TargetAppConfigSection
        config={config}
        onConfigChange={onConfigChange}
        isRunning={isRunning}
        currentRequirements={currentRequirements}
        browserTabs={browserTabs}
        browserTabsLoading={browserTabsLoading}
        browserTabsError={browserTabsError}
        onRefreshBrowserTabs={onRefreshBrowserTabs}
        onSelectBrowserTab={onSelectBrowserTab}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LimitsConfigSection
          config={config}
          onConfigChange={onConfigChange}
          isRunning={isRunning}
        />

        <TimingConfigSection
          config={config}
          onConfigChange={onConfigChange}
          isRunning={isRunning}
        />

        <SafetyConfigSection
          config={config}
          onConfigChange={onConfigChange}
          isRunning={isRunning}
        />
      </div>
    </div>
  );
}
