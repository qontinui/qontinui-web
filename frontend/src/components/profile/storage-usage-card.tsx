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
  // totalBytes is now a sentinel: -1 means unlimited (self-host default).
  // Cloud-control deployments can pass a positive cap via its own profile
  // panel; OSS callers always pass -1 from the /me/storage endpoint.
  totalBytes: number;
}

export function StorageUsageCard({
  usedBytes,
  totalBytes,
}: StorageUsageCardProps) {
  const isUnlimited = totalBytes < 0;

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
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
            <CardDescription>Your current storage usage</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Used</span>
          <span className="font-medium text-white">
            {formatBytes(usedBytes)}
            {!isUnlimited ? ` of ${formatBytes(totalBytes)}` : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
