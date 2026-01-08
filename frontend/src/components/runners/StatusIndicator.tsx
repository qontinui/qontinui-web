"use client";

import { cn } from "@/lib/utils";

type ConnectionStatus = "active" | "disconnected";

interface StatusIndicatorProps {
  status: ConnectionStatus;
  showLabel?: boolean;
  className?: string;
}

export function StatusIndicator({
  status,
  showLabel = true,
  className,
}: StatusIndicatorProps) {
  const config =
    status === "active"
      ? {
          dotClass: "bg-green-500",
          labelClass: "text-green-500",
          label: "Active",
          animate: true,
        }
      : {
          dotClass: "bg-text-muted",
          labelClass: "text-text-muted",
          label: "Disconnected",
          animate: false,
        };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex h-3 w-3">
        {config.animate && (
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              config.dotClass
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full h-3 w-3",
            config.dotClass
          )}
        />
      </div>
      {showLabel && (
        <span className={cn("text-sm font-medium", config.labelClass)}>
          {config.label}
        </span>
      )}
    </div>
  );
}
