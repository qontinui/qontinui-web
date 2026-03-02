"use client";

import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface VisionInfoAlertProps {
  sam3Enabled: boolean;
}

export function VisionInfoAlert({ sam3Enabled }: VisionInfoAlertProps) {
  return (
    <Alert className="bg-[#9B59B6]/5 border-[#9B59B6]/20">
      <Info className="h-4 w-4 text-[#9B59B6]" />
      <AlertDescription className="text-sm text-text-muted">
        Vision extraction detects GUI elements from screenshots using computer
        vision algorithms. Best for non-web applications where DOM-based
        extraction is not available.
        {sam3Enabled && (
          <span className="block mt-1">
            SAM3 requires model download on first use and a CUDA-capable GPU for
            reasonable performance.
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
