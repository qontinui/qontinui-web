"use client";

import { Button } from "@/components/ui/button";
import { Save, RotateCcw, Download } from "lucide-react";
import { useSettings } from "./_hooks/use-settings";
import { CoreSettingsCard } from "./_components/CoreSettingsCard";
import { MonitorSettingsCard } from "./_components/MonitorSettingsCard";
import { MouseSettingsCard } from "./_components/MouseSettingsCard";
import { MockSettingsCard } from "./_components/MockSettingsCard";
import { ScreenshotSettingsCard } from "./_components/ScreenshotSettingsCard";
import { RecordingSettingsCard } from "./_components/RecordingSettingsCard";
import { IllustrationSettingsCard } from "./_components/IllustrationSettingsCard";
import { AnalysisSettingsCard } from "./_components/AnalysisSettingsCard";
import { DatasetSettingsCard } from "./_components/DatasetSettingsCard";
import { TestingSettingsCard } from "./_components/TestingSettingsCard";

export function SettingsTab() {
  const {
    settings,
    loading,
    saveSettings,
    resetSettings,
    exportSettings,
    updateSetting,
  } = useSettings();

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Application Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure global properties for the Qontinui framework
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportSettings}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="outline" size="sm" onClick={resetSettings}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button size="sm" onClick={saveSettings} disabled={loading}>
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <CoreSettingsCard settings={settings} updateSetting={updateSetting} />
        <MonitorSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <MouseSettingsCard settings={settings} updateSetting={updateSetting} />
        <MockSettingsCard settings={settings} updateSetting={updateSetting} />
        <ScreenshotSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <RecordingSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <IllustrationSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <AnalysisSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <DatasetSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
        <TestingSettingsCard
          settings={settings}
          updateSetting={updateSetting}
        />
      </div>
    </div>
  );
}
