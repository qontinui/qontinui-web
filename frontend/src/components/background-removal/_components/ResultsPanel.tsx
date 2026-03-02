import React from "react";
import { Download, Eye, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BackgroundRemovalResult } from "@/types/backgroundRemoval";

interface ResultsPanelProps {
  result: BackgroundRemovalResult | null;
  error: string | null;
  onDownloadResults: () => void;
}

export const ResultsPanel: React.FC<ResultsPanelProps> = ({
  result,
  error,
  onDownloadResults,
}) => {
  return (
    <div className="w-80 bg-surface-raised border-l border-border-default flex flex-col overflow-hidden">
      <div className="p-4 border-b border-border-default">
        <h2 className="font-semibold text-white">Results</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {result ? (
          <>
            {/* Statistics */}
            <Card className="bg-surface-raised border-border-default">
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-white">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Screenshots:</span>
                  <span className="font-medium text-white">
                    {result.statistics.numScreenshots}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Image Size:</span>
                  <span className="font-medium text-white">
                    {result.statistics.imageSize[0]}×
                    {result.statistics.imageSize[1]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Foreground:</span>
                  <span className="font-medium text-brand-success">
                    {result.statistics.foregroundPercentage.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Background:</span>
                  <span className="font-medium text-red-400">
                    {result.statistics.backgroundPercentage.toFixed(1)}%
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card className="bg-surface-raised border-border-default">
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-white">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full bg-surface-canvas text-text-secondary border-border-default hover:bg-zinc-700 hover:text-white"
                  onClick={onDownloadResults}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Results
                </Button>
                <Button
                  variant="outline"
                  className="w-full bg-surface-canvas text-text-secondary border-border-default opacity-50"
                  disabled
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Use in State Discovery
                </Button>
              </CardContent>
            </Card>

            {/* Info */}
            <Alert className="bg-blue-900/20 border-blue-600 text-blue-300">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Use the processed screenshots with State Discovery for more
                accurate detection of UI elements.
              </AlertDescription>
            </Alert>
          </>
        ) : (
          <div className="text-center text-text-muted py-12">
            <p className="text-sm">No results yet</p>
            <p className="text-xs mt-2">
              Process screenshots to see statistics
            </p>
          </div>
        )}

        {error && (
          <Alert
            variant="destructive"
            className="bg-red-900/20 border-red-600 text-red-300"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
};
