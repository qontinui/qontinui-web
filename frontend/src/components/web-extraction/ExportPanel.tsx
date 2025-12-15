/**
 * Export Panel Component
 *
 * Allows users to import discovered states into their project:
 * - Select which states to import
 * - Preview import summary
 * - Trigger the import process
 * - Show import results
 */

"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileSearch,
} from "lucide-react";
import { toast } from "sonner";
import type { ImportResult } from "@/services/extraction-service";

interface ExportPanelProps {
  extractionId: string;
  selectedStateIds: Set<string>;
  totalStatesCount: number;
  onImport: (stateIds: string[]) => Promise<ImportResult>;
}

export function ExportPanel({
  extractionId,
  selectedStateIds,
  totalStatesCount,
  onImport,
}: ExportPanelProps) {
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleImport = async () => {
    if (selectedStateIds.size === 0) {
      toast.error("No states selected for import");
      return;
    }

    try {
      setIsImporting(true);
      setImportResult(null);

      const result = await onImport(Array.from(selectedStateIds));

      setImportResult(result);

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
      setImportResult(null);

      // Import all states (empty array means import all)
      const result = await onImport([]);

      setImportResult(result);

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Import States
        </CardTitle>
        <CardDescription>
          Import discovered states into your current project
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Import Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Total discovered states
            </span>
            <Badge variant="secondary">{totalStatesCount}</Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Selected for import
            </span>
            <Badge variant="default">{selectedStateIds.size}</Badge>
          </div>
        </div>

        <Separator />

        {/* Import Actions */}
        <div className="space-y-2">
          <Button
            onClick={handleImport}
            disabled={isImporting || selectedStateIds.size === 0}
            className="w-full"
            size="lg"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="mr-2 h-5 w-5" />
                Import Selected ({selectedStateIds.size})
              </>
            )}
          </Button>

          <Button
            onClick={handleImportAll}
            disabled={isImporting || totalStatesCount === 0}
            variant="outline"
            className="w-full"
          >
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FileSearch className="mr-2 h-4 w-4" />
                Import All ({totalStatesCount})
              </>
            )}
          </Button>
        </div>

        {/* Import Result */}
        {importResult && (
          <>
            <Separator />
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <div className="font-semibold">Import Complete</div>
                  <div className="text-sm space-y-1">
                    <div>
                      Imported {importResult.imported_states} state
                      {importResult.imported_states !== 1 ? "s" : ""}
                    </div>
                    {importResult.imported_transitions > 0 && (
                      <div>
                        Imported {importResult.imported_transitions} transition
                        {importResult.imported_transitions !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          </>
        )}

        {/* Help Text */}
        <Separator />
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <div className="space-y-1">
              <div className="font-semibold">Import Notes:</div>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>States will be added to your project configuration</li>
                <li>Duplicate states (same ID) will be skipped</li>
                <li>
                  You can review and edit imported states in the States tab
                </li>
                <li>Import all to add every discovered state at once</li>
              </ul>
            </div>
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
