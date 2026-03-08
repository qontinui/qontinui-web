import { Button } from "@/components/ui/button";
import { Settings, RotateCcw, Download, Save } from "lucide-react";

interface SettingsHeaderProps {
  onReset: () => void;
  onExport: () => void;
  onSave: () => void;
}

export function SettingsHeader({
  onReset,
  onExport,
  onSave,
}: SettingsHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset
        </Button>
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
        <Button size="sm" onClick={onSave}>
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </Button>
      </div>
    </div>
  );
}
