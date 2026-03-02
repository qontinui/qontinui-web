"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectSettings } from "@/types/project-settings";

import { ExecutionTab } from "./_components/execution-tab";
import { FindTab } from "./_components/find-tab";
import { KeyboardTab } from "./_components/keyboard-tab";
import { MouseTab } from "./_components/mouse-tab";
import { RecognitionTab } from "./_components/recognition-tab";
import { WaitTab } from "./_components/wait-tab";
import { useSettingsUpdater } from "./_hooks/use-settings-updater";

interface ProjectSettingsProps {
  settings: ProjectSettings;
  onUpdateSettings: (settings: ProjectSettings) => void;
}

export function ProjectSettingsComponent({
  settings,
  onUpdateSettings,
}: ProjectSettingsProps) {
  const {
    updateMouseSettings,
    updateKeyboardSettings,
    updateFindSettings,
    updateWaitSettings,
    updateExecutionSettings,
    updateRecognitionSettings,
  } = useSettingsUpdater(settings, onUpdateSettings);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Project Settings</h2>
        <p className="text-sm text-text-muted">
          Configure default behavior for automation actions
        </p>
      </div>

      <Tabs defaultValue="execution" className="w-full">
        <TabsList className="grid w-full grid-cols-6 bg-surface-raised">
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="recognition">Recognition</TabsTrigger>
          <TabsTrigger value="mouse">Mouse</TabsTrigger>
          <TabsTrigger value="keyboard">Keyboard</TabsTrigger>
          <TabsTrigger value="find">Find</TabsTrigger>
          <TabsTrigger value="wait">Wait</TabsTrigger>
        </TabsList>

        <TabsContent value="execution" className="space-y-4">
          <ExecutionTab
            execution={settings.execution}
            onUpdate={updateExecutionSettings}
          />
        </TabsContent>

        <TabsContent value="recognition" className="space-y-4">
          <RecognitionTab
            recognition={settings.recognition}
            onUpdate={updateRecognitionSettings}
          />
        </TabsContent>

        <TabsContent value="mouse" className="space-y-4">
          <MouseTab mouse={settings.mouse} onUpdate={updateMouseSettings} />
        </TabsContent>

        <TabsContent value="keyboard" className="space-y-4">
          <KeyboardTab
            keyboard={settings.keyboard}
            onUpdate={updateKeyboardSettings}
          />
        </TabsContent>

        <TabsContent value="find" className="space-y-4">
          <FindTab find={settings.find} onUpdate={updateFindSettings} />
        </TabsContent>

        <TabsContent value="wait" className="space-y-4">
          <WaitTab wait={settings.wait} onUpdate={updateWaitSettings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
