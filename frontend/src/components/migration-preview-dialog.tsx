"use client";

/**
 * Migration Preview Dialog
 *
 * Shows users what migrations will be applied before actually applying them.
 * Builds user confidence and transparency in the migration process.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Info,
  RefreshCw,
} from "lucide-react";
import { previewMigration } from "@/lib/config-migration";

interface MigrationPreviewDialogProps {
  config: unknown;
  open: boolean;
  onApprove: () => void;
  onCancel: () => void;
}

export function MigrationPreviewDialog({
  config,
  open,
  onApprove,
  onCancel,
}: MigrationPreviewDialogProps) {
  const [preview, setPreview] = useState<{
    needsMigration: boolean;
    currentVersion: string;
    targetVersion: string;
    migrationSteps: Array<{
      from: string;
      to: string;
      description: string;
    }>;
    estimatedChanges: string[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open && config) {
      loadPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const loadPreview = async () => {
    setLoading(true);
    try {
      const result = await previewMigration(config);
      setPreview(result);
    } catch (error) {
      console.error("Failed to load migration preview:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!preview && !loading) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        data-ui-id="dialog-migration-preview"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Configuration Migration Required
          </DialogTitle>
          <DialogDescription>
            Your configuration needs to be migrated from v
            {preview?.currentVersion} to v{preview?.targetVersion}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Analyzing migrations...
              </p>
            </div>
          </div>
        ) : preview && preview.needsMigration ? (
          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Version Info */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{preview.currentVersion}</Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="default">{preview.targetVersion}</Badge>
                </div>
              </AlertDescription>
            </Alert>

            {/* Migration Steps */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <h3 className="text-sm font-semibold mb-2">Migration Steps</h3>
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-4 space-y-4">
                  {preview.migrationSteps.map((step, index) => (
                    <div
                      key={`${step.from}-${step.to}`}
                      className="flex gap-3 items-start"
                    >
                      <div className="flex-shrink-0 mt-1">
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium">
                          {index + 1}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {step.from}
                          </Badge>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <Badge variant="default" className="text-xs">
                            {step.to}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Estimated Changes */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <h3 className="text-sm font-semibold mb-2">What Will Change</h3>
              <ScrollArea className="flex-1 border rounded-lg">
                <div className="p-4">
                  <ul className="space-y-2">
                    {preview.estimatedChanges.map((change, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-sm"
                      >
                        <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{change}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </ScrollArea>
            </div>

            {/* Safety Notice */}
            <Alert className="bg-muted">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Safety Guarantee:</strong> If migration fails, your
                original configuration will be preserved unchanged. Migration
                history will be tracked in the config metadata.
              </AlertDescription>
            </Alert>
          </div>
        ) : (
          <div className="py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No migration needed - your configuration is up to date!
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            data-ui-id="dialog-migration-preview-cancel-btn"
          >
            Cancel Import
          </Button>
          <Button
            onClick={onApprove}
            disabled={loading || (preview ? !preview.needsMigration : false)}
            data-ui-id="dialog-migration-preview-confirm-btn"
          >
            {preview && preview.needsMigration
              ? "Approve & Migrate"
              : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
