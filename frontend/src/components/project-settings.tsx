"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectSettings } from "@/types/project-settings";

interface ProjectSettingsProps {
  settings: ProjectSettings;
  onUpdateSettings: (settings: ProjectSettings) => void;
}

export function ProjectSettingsComponent({
  settings,
  onUpdateSettings,
}: ProjectSettingsProps) {
  const updateMouseSettings = (
    key: keyof ProjectSettings["mouse"],
    value: number | boolean
  ) => {
    onUpdateSettings({
      ...settings,
      mouse: {
        ...settings.mouse,
        [key]: value,
      },
    });
  };

  const updateKeyboardSettings = (
    key: keyof ProjectSettings["keyboard"],
    value: number
  ) => {
    onUpdateSettings({
      ...settings,
      keyboard: {
        ...settings.keyboard,
        [key]: value,
      },
    });
  };

  const updateFindSettings = (
    key: keyof ProjectSettings["find"],
    value: number
  ) => {
    onUpdateSettings({
      ...settings,
      find: {
        ...settings.find,
        [key]: value,
      },
    });
  };

  const updateWaitSettings = (
    key: keyof ProjectSettings["wait"],
    value: number
  ) => {
    onUpdateSettings({
      ...settings,
      wait: {
        ...settings.wait,
        [key]: value,
      },
    });
  };

  const updateExecutionSettings = (
    key: keyof ProjectSettings["execution"],
    value: number | string
  ) => {
    onUpdateSettings({
      ...settings,
      execution: {
        ...settings.execution,
        [key]: value,
      },
    });
  };

  const updateRecognitionSettings = (
    key: keyof ProjectSettings["recognition"],
    value: number | string | boolean
  ) => {
    onUpdateSettings({
      ...settings,
      recognition: {
        ...settings.recognition,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Project Settings</h2>
        <p className="text-sm text-gray-400">
          Configure default behavior for automation actions
        </p>
      </div>

      <Tabs defaultValue="execution" className="w-full">
        <TabsList className="grid w-full grid-cols-6 bg-gray-800">
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="recognition">Recognition</TabsTrigger>
          <TabsTrigger value="mouse">Mouse</TabsTrigger>
          <TabsTrigger value="keyboard">Keyboard</TabsTrigger>
          <TabsTrigger value="find">Find</TabsTrigger>
          <TabsTrigger value="wait">Wait</TabsTrigger>
        </TabsList>

        <TabsContent value="execution" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Execution Settings
              </CardTitle>
              <CardDescription>
                Global execution behavior and error handling
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Default Timeout (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="100"
                    value={settings.execution.default_timeout}
                    onChange={(e) =>
                      updateExecutionSettings(
                        "default_timeout",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Maximum time to wait for actions to complete
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Default Retry Count
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    value={settings.execution.default_retry_count}
                    onChange={(e) =>
                      updateExecutionSettings(
                        "default_retry_count",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Number of times to retry failed actions
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Action Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.execution.action_delay}
                    onChange={(e) =>
                      updateExecutionSettings(
                        "action_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay between consecutive actions
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Failure Strategy
                  </Label>
                  <Select
                    value={settings.execution.failure_strategy}
                    onValueChange={(value) =>
                      updateExecutionSettings("failure_strategy", value)
                    }
                  >
                    <SelectTrigger className="bg-transparent border-gray-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#27272A] border-gray-700">
                      <SelectItem value="stop">Stop on Failure</SelectItem>
                      <SelectItem value="continue">
                        Continue on Failure
                      </SelectItem>
                      <SelectItem value="pause">Pause on Failure</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    What to do when an action fails
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recognition" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Recognition Settings
              </CardTitle>
              <CardDescription>
                Image recognition and matching configuration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Minimum Similarity (0.0-1.0)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={settings.recognition.default_threshold}
                    onChange={(e) =>
                      updateRecognitionSettings(
                        "default_threshold",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Minimum similarity threshold for image matching
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">Color Space</Label>
                  <Select
                    value={settings.recognition.color_space}
                    onValueChange={(value) =>
                      updateRecognitionSettings("color_space", value)
                    }
                  >
                    <SelectTrigger className="bg-transparent border-gray-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#27272A] border-gray-700">
                      <SelectItem value="rgb">RGB</SelectItem>
                      <SelectItem value="grayscale">Grayscale</SelectItem>
                      <SelectItem value="hsv">HSV</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    Color space for image processing
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-400">
                      Multi-Scale Search
                    </Label>
                    <Switch
                      checked={settings.recognition.multi_scale_search}
                      onCheckedChange={(checked) =>
                        updateRecognitionSettings("multi_scale_search", checked)
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Search at multiple scales (experimental)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-400">
                      Edge Detection
                    </Label>
                    <Switch
                      checked={settings.recognition.edge_detection}
                      onCheckedChange={(checked) =>
                        updateRecognitionSettings("edge_detection", checked)
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Use edge detection for matching
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-400">OCR Enabled</Label>
                    <Switch
                      checked={settings.recognition.ocr_enabled}
                      onCheckedChange={(checked) =>
                        updateRecognitionSettings("ocr_enabled", checked)
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Enable optical character recognition
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mouse" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Mouse Action Timing
              </CardTitle>
              <CardDescription>
                Default timing parameters for mouse actions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Click Hold Duration (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.click_hold_duration}
                    onChange={(e) =>
                      updateMouseSettings(
                        "click_hold_duration",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    How long to hold button during click
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Click Release Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.click_release_delay}
                    onChange={(e) =>
                      updateMouseSettings(
                        "click_release_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay after releasing button
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Double Click Interval (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.double_click_interval}
                    onChange={(e) =>
                      updateMouseSettings(
                        "double_click_interval",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Time between double clicks
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-400">
                      Click Safety Release
                    </Label>
                    <Switch
                      checked={settings.mouse.click_safety_release}
                      onCheckedChange={(checked) =>
                        updateMouseSettings("click_safety_release", checked)
                      }
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Release all buttons before clicking
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Drag Start Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.drag_start_delay}
                    onChange={(e) =>
                      updateMouseSettings(
                        "drag_start_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay before starting drag
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Drag End Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.drag_end_delay}
                    onChange={(e) =>
                      updateMouseSettings(
                        "drag_end_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay after ending drag
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Drag Default Duration (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.drag_default_duration}
                    onChange={(e) =>
                      updateMouseSettings(
                        "drag_default_duration",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Default drag animation duration
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Move Default Duration (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.move_default_duration}
                    onChange={(e) =>
                      updateMouseSettings(
                        "move_default_duration",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Default move animation duration
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Safety Release Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.mouse.safety_release_delay}
                    onChange={(e) =>
                      updateMouseSettings(
                        "safety_release_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay after safety release
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="keyboard" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Keyboard Action Timing
              </CardTitle>
              <CardDescription>
                Default timing parameters for keyboard actions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Key Hold Duration (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.keyboard.key_hold_duration}
                    onChange={(e) =>
                      updateKeyboardSettings(
                        "key_hold_duration",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    How long to hold key during press
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Key Release Delay (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.keyboard.key_release_delay}
                    onChange={(e) =>
                      updateKeyboardSettings(
                        "key_release_delay",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay after releasing key
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Typing Interval (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.keyboard.typing_interval}
                    onChange={(e) =>
                      updateKeyboardSettings(
                        "typing_interval",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay between typed characters
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Hotkey Hold Duration (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.keyboard.hotkey_hold_duration}
                    onChange={(e) =>
                      updateKeyboardSettings(
                        "hotkey_hold_duration",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Duration for hotkey holds
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Hotkey Press Interval (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.keyboard.hotkey_press_interval}
                    onChange={(e) =>
                      updateKeyboardSettings(
                        "hotkey_press_interval",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Interval between hotkey presses
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="find" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Find Action Settings
              </CardTitle>
              <CardDescription>
                Default parameters for find operations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Default Timeout (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="100"
                    value={settings.find.default_timeout}
                    onChange={(e) =>
                      updateFindSettings(
                        "default_timeout",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Maximum time for find operations
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Default Retry Count
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    value={settings.find.default_retry_count}
                    onChange={(e) =>
                      updateFindSettings(
                        "default_retry_count",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Number of find retries (0 = no retries)
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Search Interval (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.find.search_interval}
                    onChange={(e) =>
                      updateFindSettings(
                        "search_interval",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Delay between search attempts
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wait" className="space-y-4">
          <Card className="border-gray-700 bg-[#27272A]">
            <CardHeader>
              <CardTitle className="text-[#00D9FF]">
                Action Pause Settings
              </CardTitle>
              <CardDescription>
                Global pauses applied to all actions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Global Pause Before Action (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.wait.pause_before_action}
                    onChange={(e) =>
                      updateWaitSettings(
                        "pause_before_action",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Pause before every action begins
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm text-gray-400">
                    Global Pause After Action (ms)
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="10"
                    value={settings.wait.pause_after_action}
                    onChange={(e) =>
                      updateWaitSettings(
                        "pause_after_action",
                        Number(e.target.value)
                      )
                    }
                    className="bg-transparent border-gray-700"
                  />
                  <p className="text-xs text-gray-500">
                    Pause after every action completes
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
