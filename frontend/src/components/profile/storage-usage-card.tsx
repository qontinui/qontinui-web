"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HardDrive } from "lucide-react";

interface StorageUsageCardProps {
  usedBytes: number;
  totalBytes: number;
}

export function StorageUsageCard({
  usedBytes,
  totalBytes,
}: StorageUsageCardProps) {
  const usedPercentage = Math.round((usedBytes / totalBytes) * 100);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const getProgressGradient = () => {
    if (usedPercentage >= 90) return "from-red-500 to-red-600";
    if (usedPercentage >= 75) return "from-yellow-500 to-orange-500";
    return "from-brand-primary to-brand-secondary";
  };

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-primary/20 rounded-lg flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-brand-primary" />
          </div>
          <div>
            <CardTitle className="text-xl">Storage Usage</CardTitle>
            <CardDescription>Your current storage allocation</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Used</span>
            <span className="font-medium text-white">
              {formatBytes(usedBytes)} of {formatBytes(totalBytes)}
            </span>
          </div>

          {/* Custom Progress Bar with gradient */}
          <div className="relative h-3 bg-surface-raised rounded-full overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${getProgressGradient()} transition-all duration-500`}
              style={{ width: `${usedPercentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Usage</span>
            <span
              className={`font-bold ${
                usedPercentage >= 90
                  ? "text-red-400"
                  : usedPercentage >= 75
                    ? "text-yellow-400"
                    : "text-brand-primary"
              }`}
            >
              {usedPercentage}%
            </span>
          </div>
        </div>

        {usedPercentage >= 90 && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">
              You&apos;re running low on storage space. Consider upgrading your
              plan or removing unused files.
            </p>
          </div>
        )}

        {usedPercentage >= 75 && usedPercentage < 90 && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <p className="text-sm text-yellow-400">
              You&apos;re using more than 75% of your storage. Consider managing
              your files.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="p-3 bg-surface-canvas/50 rounded-lg border border-border-subtle">
            <p className="text-xs text-text-muted mb-1">Files</p>
            <p className="text-lg font-bold text-white">
              {formatBytes(usedBytes)}
            </p>
          </div>
          <div className="p-3 bg-surface-canvas/50 rounded-lg border border-border-subtle">
            <p className="text-xs text-text-muted mb-1">Available</p>
            <p className="text-lg font-bold text-brand-success">
              {formatBytes(totalBytes - usedBytes)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
