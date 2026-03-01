import React from "react";
import { Upload, AlertCircle } from "lucide-react";

interface ConfigLoadingStatusProps {
  configLoaded: boolean;
  configLoadError: string | null;
}

export function ConfigLoadingStatus({
  configLoaded,
  configLoadError,
}: ConfigLoadingStatusProps) {
  if (!configLoaded && !configLoadError) return null;

  return (
    <div
      className={`rounded-lg p-4 space-y-3 border ${
        configLoaded
          ? "bg-green-950/30 border-green-700"
          : "bg-yellow-950/30 border-yellow-700"
      }`}
    >
      <div className="flex items-center gap-2">
        {configLoaded ? (
          <>
            <Upload className="w-4 h-4 text-green-400" />
            <span className="font-medium text-green-400 text-sm">
              Config Loaded to Runner
            </span>
          </>
        ) : (
          <>
            <AlertCircle className="w-4 h-4 text-yellow-400" />
            <span className="font-medium text-yellow-400 text-sm">
              Config Not Loaded
            </span>
          </>
        )}
      </div>
      {configLoaded ? (
        <p className="text-sm text-green-400/90">
          Configuration is loaded into the runner and ready for automation
          execution.
        </p>
      ) : (
        <p className="text-sm text-yellow-400/90">
          {configLoadError ||
            "Config was exported but could not be loaded into the runner."}
        </p>
      )}
    </div>
  );
}
