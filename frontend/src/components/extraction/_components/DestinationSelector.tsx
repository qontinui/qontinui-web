/**
 * Destination Selector
 *
 * Radio group for choosing the export destination (download, S3, local path),
 * plus configuration panels for S3 and local path options.
 */

import { Download, Cloud, FolderOpen, Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  ExportDestination,
  S3Config,
  LocalPathConfig,
} from "../_hooks/training-data-export-types";

interface DestinationSelectorProps {
  destination: ExportDestination;
  onDestinationChange: (dest: ExportDestination) => void;
  s3Config: S3Config;
  onS3ConfigChange: (config: S3Config) => void;
  localPathConfig: LocalPathConfig;
  onLocalPathConfigChange: (config: LocalPathConfig) => void;
}

export function DestinationSelector({
  destination,
  onDestinationChange,
  s3Config,
  onS3ConfigChange,
  localPathConfig,
  onLocalPathConfigChange,
}: DestinationSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Export Destination</Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-text-muted cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-[250px]">
              <p className="text-xs">
                S3 and local path options require backend integration. Currently
                falls back to browser download.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <RadioGroup
        value={destination}
        onValueChange={(v) => onDestinationChange(v as ExportDestination)}
        className="grid grid-cols-3 gap-2"
      >
        <div>
          <RadioGroupItem
            value="download"
            id="dest-download"
            className="peer sr-only"
          />
          <Label
            htmlFor="dest-download"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
          >
            <Download className="h-4 w-4" />
            <span className="text-xs mt-1">Download</span>
          </Label>
        </div>
        <div>
          <RadioGroupItem value="s3" id="dest-s3" className="peer sr-only" />
          <Label
            htmlFor="dest-s3"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
          >
            <Cloud className="h-4 w-4" />
            <span className="text-xs mt-1">S3 Bucket</span>
          </Label>
        </div>
        <div>
          <RadioGroupItem
            value="local"
            id="dest-local"
            className="peer sr-only"
          />
          <Label
            htmlFor="dest-local"
            className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-3 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-[#9B59B6] cursor-pointer transition-colors"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="text-xs mt-1">Local Path</span>
          </Label>
        </div>
      </RadioGroup>

      {/* S3 Configuration */}
      {destination === "s3" && (
        <S3ConfigPanel config={s3Config} onChange={onS3ConfigChange} />
      )}

      {/* Local Path Configuration */}
      {destination === "local" && (
        <LocalPathConfigPanel
          config={localPathConfig}
          onChange={onLocalPathConfigChange}
        />
      )}
    </div>
  );
}

function S3ConfigPanel({
  config,
  onChange,
}: {
  config: S3Config;
  onChange: (config: S3Config) => void;
}) {
  return (
    <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
      <div className="flex items-center gap-2 text-xs text-amber-500">
        <Info className="h-3 w-3" />
        <span>Backend integration required - falls back to download</span>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">S3 Bucket</Label>
        <Input
          placeholder="my-training-bucket"
          value={config.bucket}
          onChange={(e) => onChange({ ...config, bucket: e.target.value })}
          className="text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Prefix (Path)</Label>
        <Input
          placeholder="training-data/"
          value={config.prefix}
          onChange={(e) => onChange({ ...config, prefix: e.target.value })}
          className="text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Region</Label>
        <Input
          placeholder="us-east-1"
          value={config.region}
          onChange={(e) => onChange({ ...config, region: e.target.value })}
          className="text-sm"
        />
      </div>
    </div>
  );
}

function LocalPathConfigPanel({
  config,
  onChange,
}: {
  config: LocalPathConfig;
  onChange: (config: LocalPathConfig) => void;
}) {
  return (
    <div className="space-y-3 p-3 rounded-lg bg-surface-canvas border border-border-subtle">
      <div className="flex items-center gap-2 text-xs text-amber-500">
        <Info className="h-3 w-3" />
        <span>Backend integration required - falls back to download</span>
      </div>
      <div className="space-y-2">
        <Label className="text-xs">Local Directory Path</Label>
        <Input
          placeholder="/path/to/training/data"
          value={config.path}
          onChange={(e) => onChange({ path: e.target.value })}
          className="text-sm font-mono"
        />
        <p className="text-xs text-text-muted">
          Path on the server where training data will be saved
        </p>
      </div>
    </div>
  );
}
