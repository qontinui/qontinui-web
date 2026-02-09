"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Download, Copy, Check, FileJson, Upload } from "lucide-react";
import { toast } from "sonner";
import type {
  UIBridgeState,
  UIBridgeTransition,
  ElementFingerprint,
  BuilderAction,
} from "@/lib/state-machine-builder/types";
import {
  buildUIBridgeConfig,
  downloadConfig,
  copyConfigToClipboard,
  validateAndParseConfig,
  type ExportOptions,
} from "@/lib/state-machine-builder/export";

interface ExportPanelProps {
  states: UIBridgeState[];
  transitions: UIBridgeTransition[];
  fingerprintDetails: Record<string, ElementFingerprint>;
  configName: string;
  isDirty?: boolean;
  dispatch?: React.Dispatch<BuilderAction>;
}

export function ExportPanel({
  states,
  transitions,
  fingerprintDetails,
  configName,
  isDirty,
  dispatch,
}: ExportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleImportFile = useCallback(
    (file: File) => {
      if (!dispatch) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text !== "string") return;
        const result = validateAndParseConfig(text);
        if ("error" in result) {
          toast.error(`Import failed: ${result.error}`);
          return;
        }
        if (isDirty) {
          if (
            !window.confirm(
              "You have unsaved changes. Loading a config will discard them. Continue?"
            )
          ) {
            return;
          }
        }
        dispatch({ type: "LOAD_CONFIG", config: result.config });
        toast.success(
          `Imported "${result.config.name}" with ${result.config.states.length} states`
        );
      };
      reader.readAsText(file);
    },
    [dispatch, isDirty]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
      e.target.value = "";
    },
    [handleImportFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".json")) {
        handleImportFile(file);
      } else {
        toast.error("Please drop a .json file");
      }
    },
    [handleImportFile]
  );

  const [options, setOptions] = useState<ExportOptions>({
    configName,
    includeGlobalStates: true,
    includeModalStates: true,
    includeElementDetails: true,
  });
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const config = useMemo(
    () => buildUIBridgeConfig(states, transitions, fingerprintDetails, options),
    [states, transitions, fingerprintDetails, options]
  );

  const jsonPreview = useMemo(() => JSON.stringify(config, null, 2), [config]);

  const handleDownload = () => {
    downloadConfig(config);
    toast.success("Config downloaded");
  };

  const handleCopy = async () => {
    try {
      await copyConfigToClipboard(config);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileJson className="size-5 text-text-muted" />
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wide">
          Export
        </h3>
      </div>

      {/* Config Name */}
      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Config Name</Label>
        <Input
          value={options.configName}
          onChange={(e) =>
            setOptions((prev) => ({ ...prev, configName: e.target.value }))
          }
          className="bg-surface-canvas border-border-subtle text-sm"
        />
      </div>

      <Separator className="bg-border-subtle" />

      {/* Options */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Options
        </h4>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-text-secondary">
            Include Global States
          </Label>
          <Switch
            checked={options.includeGlobalStates}
            onCheckedChange={(checked) =>
              setOptions((prev) => ({ ...prev, includeGlobalStates: checked }))
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-text-secondary">
            Include Modal States
          </Label>
          <Switch
            checked={options.includeModalStates}
            onCheckedChange={(checked) =>
              setOptions((prev) => ({ ...prev, includeModalStates: checked }))
            }
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-sm text-text-secondary">
            Include Element Details
          </Label>
          <Switch
            checked={options.includeElementDetails}
            onCheckedChange={(checked) =>
              setOptions((prev) => ({
                ...prev,
                includeElementDetails: checked,
              }))
            }
          />
        </div>
      </div>

      <Separator className="bg-border-subtle" />

      {/* Export Summary */}
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Export Summary
        </h4>
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant="outline"
            className="border-border-subtle text-text-secondary"
          >
            {config.states.length} states
          </Badge>
          <Badge
            variant="outline"
            className="border-border-subtle text-text-secondary"
          >
            {config.transitions.length} transitions
          </Badge>
          {config.fingerprintDetails && (
            <Badge
              variant="outline"
              className="border-border-subtle text-text-secondary"
            >
              {Object.keys(config.fingerprintDetails).length} fingerprints
            </Badge>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleDownload}
          className="flex-1 bg-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/80 text-black"
        >
          <Download className="size-4 mr-2" />
          Download
        </Button>
        <Button
          onClick={handleCopy}
          variant="outline"
          className="flex-1 border-border-subtle"
        >
          {copied ? (
            <Check className="size-4 mr-2 text-green-400" />
          ) : (
            <Copy className="size-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <Separator className="bg-border-subtle" />

      {/* JSON Preview */}
      <div className="space-y-2">
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-xs font-medium text-text-muted uppercase tracking-wide hover:text-text-secondary transition-colors"
        >
          {showPreview ? "Hide" : "Show"} JSON Preview
        </button>
        {showPreview && (
          <Card className="bg-surface-canvas border-border-subtle/50">
            <CardContent className="p-0">
              <ScrollArea className="h-64">
                <pre className="p-3 text-xs text-text-muted font-mono whitespace-pre-wrap break-all">
                  {jsonPreview}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Import */}
      {dispatch && (
        <>
          <Separator className="bg-border-subtle" />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-text-muted" />
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Import
              </h4>
            </div>
            <div
              className={[
                "rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer",
                dragOver
                  ? "border-[var(--brand-primary)] bg-[var(--brand-primary)]/5"
                  : "border-border-subtle hover:border-border-subtle/80",
              ].join(" ")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-6 mx-auto text-text-muted mb-2" />
              <p className="text-xs text-text-muted">
                Drop a JSON file here or click to browse
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
