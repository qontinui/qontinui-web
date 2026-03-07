"use client";

import { Button } from "@/components/ui/button";
import { Download, Loader2, FileJson, Upload } from "lucide-react";

interface ExportPanelProps {
  isExporting: boolean;
  isPushing: boolean;
  onDownload: () => void;
  onPushToRunner: () => void;
  configName: string | null;
  stateCount: number;
  transitionCount: number;
}

export function ExportPanel({
  isExporting,
  isPushing,
  onDownload,
  onPushToRunner,
  configName,
  stateCount,
  transitionCount,
}: ExportPanelProps) {
  return (
    <div className="p-6 space-y-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <FileJson className="size-5 text-brand-primary" />
        <h2 className="text-lg font-semibold text-text-primary">Export</h2>
      </div>

      <div className="rounded-lg border border-border-primary bg-surface-secondary p-4 space-y-3">
        <p className="text-sm text-text-primary">
          Export the state machine as JSON compatible with{" "}
          <code className="text-xs bg-surface-primary px-1 py-0.5 rounded">
            UIBridgeRuntime.from_dict()
          </code>
        </p>

        <div className="text-xs text-text-muted space-y-1">
          {configName && (
            <div>
              Config: <strong>{configName}</strong>
            </div>
          )}
          <div>{stateCount} states</div>
          <div>{transitionCount} transitions</div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={onDownload}
            disabled={isExporting || !configName}
            data-ui-id="sm-export-download"
          >
            {isExporting ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="size-4 mr-1.5" />
            )}
            Download JSON
          </Button>

          <Button
            variant="outline"
            onClick={onPushToRunner}
            disabled={isPushing || isExporting || !configName}
            data-ui-id="sm-export-push-runner"
          >
            {isPushing ? (
              <Loader2 className="size-4 mr-1.5 animate-spin" />
            ) : (
              <Upload className="size-4 mr-1.5" />
            )}
            Push to Runner
          </Button>
        </div>
      </div>
    </div>
  );
}
