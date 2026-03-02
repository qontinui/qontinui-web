"use client";

import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { ExportResult } from "./types";

interface ExportResultCardProps {
  result: ExportResult;
}

export function ExportResultCard({ result }: ExportResultCardProps) {
  return (
    <Card
      className={`border ${
        result.success
          ? "bg-green-950/20 border-green-500/50"
          : "bg-red-950/20 border-red-500/50"
      }`}
    >
      <CardContent className="flex items-start gap-3 py-4">
        {result.success ? (
          <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
        )}
        <div className="flex-1">
          <p
            className={`font-medium ${
              result.success ? "text-green-400" : "text-red-400"
            }`}
          >
            {result.success ? "Export Successful" : "Export Failed"}
          </p>
          <p className="text-sm text-text-muted mt-1">{result.message}</p>
          {result.elementCount !== undefined && (
            <p className="text-sm text-text-muted mt-1">
              {result.elementCount} elements
              {result.exportSize && ` | ${formatBytes(result.exportSize)}`}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
