import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Code, Zap, Bell, Shield } from "lucide-react";

export function SettingsTabList() {
  return (
    <TabsList>
      <TabsTrigger value="general">
        <Settings className="w-4 h-4 mr-2" />
        General
      </TabsTrigger>
      <TabsTrigger value="editor">
        <Code className="w-4 h-4 mr-2" />
        Editor
      </TabsTrigger>
      <TabsTrigger value="execution">
        <Zap className="w-4 h-4 mr-2" />
        Execution
      </TabsTrigger>
      <TabsTrigger value="notifications">
        <Bell className="w-4 h-4 mr-2" />
        Notifications
      </TabsTrigger>
      <TabsTrigger value="advanced">
        <Shield className="w-4 h-4 mr-2" />
        Advanced
      </TabsTrigger>
    </TabsList>
  );
}
