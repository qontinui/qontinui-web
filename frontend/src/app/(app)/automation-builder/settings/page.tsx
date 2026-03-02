"use client";

import { RequireProject } from "@/components/require-project";
import { Tabs } from "@/components/ui/tabs";
import { useSettings } from "./_hooks/useSettings";
import { SettingsHeader } from "./_components/SettingsHeader";
import { SettingsTabList } from "./_components/SettingsTabList";
import { GeneralTab } from "./_components/GeneralTab";
import { EditorTab } from "./_components/EditorTab";
import { ExecutionTab } from "./_components/ExecutionTab";
import { NotificationsTab } from "./_components/NotificationsTab";
import { AdvancedTab } from "./_components/AdvancedTab";
import { InfoBanner } from "./_components/InfoBanner";

export default function SettingsPage() {
  const { settings, updateSetting, handleSave, handleReset, handleExport } =
    useSettings();

  return (
    <RequireProject pageName="Settings">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <SettingsHeader
          onReset={handleReset}
          onExport={handleExport}
          onSave={handleSave}
        />

        <div className="flex-1 overflow-auto p-6 space-y-6 max-w-5xl mx-auto w-full">
          <Tabs defaultValue="general" className="space-y-6">
            <SettingsTabList />
            <GeneralTab settings={settings} updateSetting={updateSetting} />
            <EditorTab settings={settings} updateSetting={updateSetting} />
            <ExecutionTab settings={settings} updateSetting={updateSetting} />
            <NotificationsTab
              settings={settings}
              updateSetting={updateSetting}
            />
            <AdvancedTab settings={settings} updateSetting={updateSetting} />
          </Tabs>

          <InfoBanner />
        </div>
      </div>
    </RequireProject>
  );
}
