import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AutomationSettings } from "../types";

interface EditorTabProps {
  settings: AutomationSettings;
  updateSetting: <K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K]
  ) => void;
}

export function EditorTab({ settings, updateSetting }: EditorTabProps) {
  return (
    <TabsContent value="editor" className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Editor Preferences</CardTitle>
          <CardDescription>
            Customize the workflow editor experience
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(value) => updateSetting("theme", value)}
            >
              <SelectTrigger
                id="theme"
                data-ui-id="automation-settings-theme-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="auto">Auto</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="fontSize">Font Size</Label>
            <Input
              id="fontSize"
              type="number"
              min={10}
              max={24}
              value={settings.fontSize}
              onChange={(e) =>
                updateSetting("fontSize", parseInt(e.target.value))
              }
              data-ui-id="automation-settings-font-size-input"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Show Line Numbers</Label>
              <p className="text-sm text-muted-foreground">
                Display line numbers in code editor
              </p>
            </div>
            <Switch
              checked={settings.showLineNumbers}
              onCheckedChange={(checked) =>
                updateSetting("showLineNumbers", checked)
              }
              data-ui-id="automation-settings-show-line-numbers-toggle"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Auto-complete</Label>
              <p className="text-sm text-muted-foreground">
                Show suggestions while typing
              </p>
            </div>
            <Switch
              checked={settings.enableAutoComplete}
              onCheckedChange={(checked) =>
                updateSetting("enableAutoComplete", checked)
              }
              data-ui-id="automation-settings-enable-auto-complete-toggle"
            />
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
}
