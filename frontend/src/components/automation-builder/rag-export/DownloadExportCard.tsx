"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Loader2, Database } from "lucide-react";

interface DownloadExportCardProps {
  isExporting: boolean;
  onDownload: () => void;
}

export function DownloadExportCard({
  isExporting,
  onDownload,
}: DownloadExportCardProps) {
  return (
    <Card className="bg-surface-canvas border-border-subtle">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-brand-primary" />
          <div>
            <CardTitle className="text-lg">Download Export</CardTitle>
            <CardDescription>
              Download RAG config as JSON file for manual import
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          onClick={onDownload}
          disabled={isExporting}
          variant="outline"
          className="w-full border-border-default"
          data-ui-id="automation-rag-download-btn"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exporting...
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download RAG Config
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
