"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionPropertiesComponentProps } from "../types";
import { TimingProperties } from "../TimingProperties";
import { Camera, FolderOpen } from "lucide-react";

/**
 * Properties component for SCREENSHOT action.
 * Allows configuring screenshot capture with optional region, output variable, and file saving.
 */
export function ScreenshotActionProperties({
  action,
  updateConfig,
}: ActionPropertiesComponentProps) {
  const hasRegion = Boolean(action.config.captureRegion);
  const saveToFile = action.config.saveToFile as
    | { enabled: boolean; filename?: string; directory?: string }
    | undefined;

  return (
    <>
      {/* Output Variable */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">
          Output Variable (optional)
        </Label>
        <Input
          type="text"
          value={(action.config.outputVariable as string) || ""}
          onChange={(e) =>
            updateConfig("outputVariable", e.target.value || undefined)
          }
          className="bg-transparent border-border-default"
          placeholder="screenshot_data"
        />
        <p className="text-xs text-text-muted">
          Variable name to store the screenshot data (base64 PNG)
        </p>
      </div>

      {/* Save to File */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-text-muted" />
            <Label className="text-xs text-text-muted">Save to File</Label>
          </div>
          <Checkbox
            id="saveToFile"
            checked={saveToFile?.enabled || false}
            onCheckedChange={(checked) => {
              if (checked) {
                updateConfig("saveToFile", {
                  enabled: true,
                  filename: saveToFile?.filename || "",
                  directory: saveToFile?.directory || "",
                });
              } else {
                updateConfig("saveToFile", { enabled: false });
              }
            }}
          />
        </div>

        {saveToFile?.enabled && (
          <div className="space-y-3 pl-4 border-l-2 border-violet-500/30">
            {/* Filename */}
            <div className="space-y-1">
              <Label className="text-xs text-text-muted">
                Filename (optional)
              </Label>
              <Input
                type="text"
                value={saveToFile?.filename || ""}
                onChange={(e) =>
                  updateConfig("saveToFile", {
                    ...saveToFile,
                    filename: e.target.value || undefined,
                  })
                }
                className="bg-transparent border-border-default"
                placeholder="screenshot-{{timestamp}}.png"
              />
              <p className="text-xs text-text-muted">
                Leave empty for auto-generated name. Supports {"{{timestamp}}"}{" "}
                placeholder.
              </p>
            </div>

            {/* Directory */}
            <div className="space-y-1">
              <Label className="text-xs text-text-muted">
                Directory (optional)
              </Label>
              <Input
                type="text"
                value={saveToFile?.directory || ""}
                onChange={(e) =>
                  updateConfig("saveToFile", {
                    ...saveToFile,
                    directory: e.target.value || undefined,
                  })
                }
                className="bg-transparent border-border-default"
                placeholder=".automation-results/latest/screenshots"
              />
              <p className="text-xs text-text-muted">
                Default: AI Builder screenshot directory for analysis
              </p>
            </div>

            <div className="flex items-start gap-2 p-2 bg-violet-500/10 rounded text-xs text-violet-300">
              <Camera className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Screenshots saved here will be available for AI analysis in the
                recursive automation loop.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Capture Region */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-text-muted">
            Capture Region (optional)
          </Label>
          <Checkbox
            id="captureRegion"
            checked={hasRegion}
            onCheckedChange={(checked) => {
              if (checked) {
                updateConfig("captureRegion", true);
                // Set default region values
                if (!action.config.region) {
                  updateConfig("region", {
                    x: 0,
                    y: 0,
                    width: 800,
                    height: 600,
                  });
                }
              } else {
                updateConfig("captureRegion", false);
                updateConfig("region", undefined);
              }
            }}
          />
        </div>

        {hasRegion && (
          <div className="space-y-2 pl-4 border-l-2 border-violet-500/30">
            <p className="text-xs text-text-muted">
              Capture a specific region instead of full screen
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-text-muted">X</Label>
                <Input
                  type="number"
                  min="0"
                  value={
                    (
                      action.config.region as {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                      }
                    )?.x || 0
                  }
                  onChange={(e) =>
                    updateConfig("region", {
                      ...(action.config.region as object),
                      x: Number.parseInt(e.target.value) || 0,
                    })
                  }
                  className="bg-transparent border-border-default"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-muted">Y</Label>
                <Input
                  type="number"
                  min="0"
                  value={
                    (
                      action.config.region as {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                      }
                    )?.y || 0
                  }
                  onChange={(e) =>
                    updateConfig("region", {
                      ...(action.config.region as object),
                      y: Number.parseInt(e.target.value) || 0,
                    })
                  }
                  className="bg-transparent border-border-default"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-muted">Width</Label>
                <Input
                  type="number"
                  min="1"
                  value={
                    (
                      action.config.region as {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                      }
                    )?.width || 800
                  }
                  onChange={(e) =>
                    updateConfig("region", {
                      ...(action.config.region as object),
                      width: Number.parseInt(e.target.value) || 800,
                    })
                  }
                  className="bg-transparent border-border-default"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-text-muted">Height</Label>
                <Input
                  type="number"
                  min="1"
                  value={
                    (
                      action.config.region as {
                        x: number;
                        y: number;
                        width: number;
                        height: number;
                      }
                    )?.height || 600
                  }
                  onChange={(e) =>
                    updateConfig("region", {
                      ...(action.config.region as object),
                      height: Number.parseInt(e.target.value) || 600,
                    })
                  }
                  className="bg-transparent border-border-default"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <TimingProperties action={action} updateConfig={updateConfig} />
    </>
  );
}
