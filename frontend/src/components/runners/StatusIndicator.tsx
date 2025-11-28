"use client";

import { cn } from "@/lib/utils";
import type { TokenStatus } from "@/types/runner";

interface StatusIndicatorProps {
  status: TokenStatus;
  showLabel?: boolean;
  className?: string;
}

export function StatusIndicator({
  status,
  showLabel = true,
  className,
}: StatusIndicatorProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "active":
        return {
          dotClass: "bg-green-500",
          labelClass: "text-green-500",
          label: "Active",
          animate: true,
        };
      case "expired":
        return {
          dotClass: "bg-orange-500",
          labelClass: "text-orange-500",
          label: "Expired",
          animate: false,
        };
      case "revoked":
        return {
          dotClass: "bg-red-500",
          labelClass: "text-red-500",
          label: "Revoked",
          animate: false,
        };
    }
  };

  const config = getStatusConfig();

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
