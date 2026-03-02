import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2 } from "lucide-react";
import { SnapshotMultiSelector } from "@/components/integration-testing/SnapshotMultiSelector";
import type { SnapshotRun } from "@/types/snapshots";

interface SnapshotSelectionStepProps {
  selectedSnapshots: SnapshotRun[];
  onChangeSnapshots: (snapshots: SnapshotRun[]) => void;
  loadingScreenshots: boolean;
  screenshotCount: number;
}

export default function SnapshotSelectionStep({
  selectedSnapshots,
  onChangeSnapshots,
  loadingScreenshots,
  screenshotCount,
}: SnapshotSelectionStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-sm font-bold">
            1
          </div>
          Select Snapshot Runs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SnapshotMultiSelector
          selectedSnapshots={selectedSnapshots}
          onChange={onChangeSnapshots}
        />

        {loadingScreenshots && (
          <div className="flex items-center justify-center py-4 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span>Loading screenshots...</span>
          </div>
        )}

        {screenshotCount > 0 && !loadingScreenshots && (
          <Alert className="mt-3">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>
              Loaded {screenshotCount} screenshot
              {screenshotCount !== 1 ? "s" : ""} ready for pattern extraction
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
