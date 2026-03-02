"use client";

import { Eye, Upload, Monitor, AppWindow } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import type {
  VisionExtractionConfig,
  VisionExtractionSource,
} from "@/types/extraction-unified";

const SOURCE_OPTIONS: {
  id: VisionExtractionSource;
  label: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    id: "upload",
    label: "Upload Screenshot",
    icon: <Upload className="h-4 w-4" />,
    description: "Upload an image file",
  },
  {
    id: "monitor",
    label: "Capture Monitor",
    icon: <Monitor className="h-4 w-4" />,
    description: "Capture from a monitor",
  },
  {
    id: "window",
    label: "Capture Window",
    icon: <AppWindow className="h-4 w-4" />,
    description: "Capture a specific window",
  },
];

interface SourceSelectionCardProps {
  config: VisionExtractionConfig;
  updateConfig: (updates: Partial<VisionExtractionConfig>) => void;
}

export function SourceSelectionCard({
  config,
  updateConfig,
}: SourceSelectionCardProps) {
  return (
    <Card className="p-4 bg-surface-raised/60 border-[#9B59B6]/20">
      <div className="flex items-center gap-2 mb-4">
        <Eye className="h-5 w-5 text-[#9B59B6]" />
        <Label className="text-[#9B59B6] font-mono uppercase tracking-wider">
          Screenshot Source
        </Label>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {SOURCE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => updateConfig({ source: option.id })}
            className={`p-3 rounded-lg border-2 transition-all text-left ${
              config.source === option.id
                ? "border-[#9B59B6] bg-[#9B59B6]/10"
                : "border-border-subtle hover:border-border-default bg-surface-canvas/50"
            }`}
          >
            <div
              className={`mb-2 ${
                config.source === option.id
                  ? "text-[#9B59B6]"
                  : "text-text-muted"
              }`}
            >
              {option.icon}
            </div>
            <div
              className={`text-sm font-medium ${
                config.source === option.id
                  ? "text-[#9B59B6]"
                  : "text-text-primary"
              }`}
            >
              {option.label}
            </div>
            <div className="text-xs text-text-muted">{option.description}</div>
          </button>
        ))}
      </div>

      {config.source === "upload" && (
        <div className="space-y-2">
          <Label className="text-sm text-text-muted">Screenshot Path</Label>
          <Input
            data-ui-id="extraction-vision-screenshot-path-input"
            value={config.screenshotPath || ""}
            onChange={(e) => updateConfig({ screenshotPath: e.target.value })}
            placeholder="C:\path\to\screenshot.png"
            className="font-mono text-sm"
          />
        </div>
      )}

      {config.source === "window" && (
        <div className="space-y-2">
          <Label className="text-sm text-text-muted">Window Title</Label>
          <Input
            data-ui-id="extraction-vision-window-title-input"
            value={config.windowTitle || ""}
            onChange={(e) => updateConfig({ windowTitle: e.target.value })}
            placeholder="e.g., Notepad, Calculator"
            className="font-mono text-sm"
          />
        </div>
      )}

      {config.source === "monitor" && (
        <div className="space-y-2">
          <Label className="text-sm text-text-muted">Monitor Index</Label>
          <Input
            type="number"
            data-ui-id="extraction-vision-monitor-index-input"
            value={config.monitorIndex ?? 0}
            onChange={(e) =>
              updateConfig({ monitorIndex: parseInt(e.target.value) || 0 })
            }
            min={0}
            className="font-mono text-sm w-24"
          />
        </div>
      )}
    </Card>
  );
}
