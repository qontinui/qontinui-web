/**
 * Import Buttons Component
 *
 * Compact horizontal buttons for importing states:
 * - Import Selected: imports only selected states
 * - Import All: imports all discovered states
 */

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, FileSearch } from "lucide-react";
import { toast } from "sonner";
import type { ImportResult } from "@/services/extraction-service";

interface ImportButtonsProps {
  selectedStateIds: Set<string>;
  totalStatesCount: number;
  onImport: (stateIds: string[]) => Promise<ImportResult>;
  disabled?: boolean;
}

export function ImportButtons({
  selectedStateIds,
  totalStatesCount,
  onImport,
  disabled,
}: ImportButtonsProps) {
  const [isImporting, setIsImporting] = useState(false);

  const handleImportSelected = async () => {
    if (selectedStateIds.size === 0) {
      toast.error("No states selected for import");
      return;
    }

    try {
      setIsImporting(true);
      const stateIdsArray = Array.from(selectedStateIds);
      const result = await onImport(stateIdsArray);

      if (result.imported_states > 0) {
        toast.success(
          `Successfully imported ${result.imported_states} state${
            result.imported_states !== 1 ? "s" : ""
          }`
        );
      } else {
        toast.info("No new states were imported (all already exist)");
      }
    } catch (error) {
      console.error("Failed to import states:", error);
      toast.error("Failed to import states");
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportAll = async () => {
    try {
      setIsImporting(true);
      const result = await onImport([]);

      if (result.imported_states > 0) {
        toast.success(
          `Successfully imported all ${result.imported_states} state${
            result.imported_states !== 1 ? "s" : ""
          }`
        );
      } else {
        toast.info("No new states were imported (all already exist)");
      }
    } catch (error) {
      console.error("Failed to import all states:", error);
      toast.error("Failed to import states");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        onClick={handleImportSelected}
        disabled={disabled || isImporting || selectedStateIds.size === 0}
        size="sm"
      >
        {isImporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Import Selected ({selectedStateIds.size})
      </Button>

      <Button
        onClick={handleImportAll}
        disabled={disabled || isImporting || totalStatesCount === 0}
        variant="outline"
        size="sm"
      >
        {isImporting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSearch className="mr-2 h-4 w-4" />
        )}
        Import All ({totalStatesCount})
      </Button>
    </div>
  );
}
