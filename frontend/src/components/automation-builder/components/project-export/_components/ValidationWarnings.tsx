import React from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Wrench } from "lucide-react";

interface ValidationWarningsProps {
  errors: string[];
  isFixing: boolean;
  onFixIssues: () => void;
}

export function ValidationWarnings({
  errors,
  isFixing,
  onFixIssues,
}: ValidationWarningsProps) {
  if (errors.length === 0) return null;

  return (
    <div className="bg-yellow-950/30 border border-yellow-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-yellow-500">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Validation Warnings</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onFixIssues}
          disabled={isFixing}
          className="border-yellow-700 text-yellow-500 hover:bg-yellow-950/50"
          data-ui-id="automation-export-fix-btn"
        >
          {isFixing ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Fixing...
            </>
          ) : (
            <>
              <Wrench className="w-3 h-3 mr-1" />
              Fix Issues
            </>
          )}
        </Button>
      </div>
      <ul className="text-sm text-yellow-400 space-y-1 list-disc list-inside">
        {errors.slice(0, 5).map((error, i) => (
          <li key={i}>{error}</li>
        ))}
        {errors.length > 5 && <li>...and {errors.length - 5} more</li>}
      </ul>
    </div>
  );
}
