"use client";

import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useRagExport } from "./rag-export/useRagExport";
import { StatusCard } from "./rag-export/StatusCard";
import { ExportOptionsCard } from "./rag-export/ExportOptionsCard";
import { TransferToRunnerCard } from "./rag-export/TransferToRunnerCard";
import { DownloadExportCard } from "./rag-export/DownloadExportCard";
import { ExportResultCard } from "./rag-export/ExportResultCard";
import { InfoBanner } from "./rag-export/InfoBanner";

interface RAGExportPanelProps {
  projectId: string | null;
}

export function RAGExportPanel({ projectId }: RAGExportPanelProps) {
  const {
    exportStatus,
    isLoadingStatus,
    isExporting,
    isTransferring,
    exportProgress,
    embeddingProgress,
    lastExportResult,
    options,
    setOptions,
    selectedRunnerId,
    setSelectedRunnerId,
    handleDownloadExport,
    handleTransferToRunner,
  } = useRagExport(projectId);

  const { connections: activeConnections, isLoading: connectionsLoading } =
    useRealtimeConnections();

  if (!projectId) {
    return (
      <Card className="border-yellow-500/50 bg-yellow-950/20">
        <CardContent className="flex items-center gap-3 py-6">
          <AlertCircle className="w-5 h-5 text-yellow-500" />
          <div>
            <p className="font-medium text-yellow-400">No project selected</p>
            <p className="text-sm text-text-muted">
              Select a project to enable RAG export
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <StatusCard
        exportStatus={exportStatus}
        isLoadingStatus={isLoadingStatus}
      />

      <ExportOptionsCard options={options} setOptions={setOptions} />

      <TransferToRunnerCard
        activeConnections={activeConnections}
        connectionsLoading={connectionsLoading}
        selectedRunnerId={selectedRunnerId}
        setSelectedRunnerId={setSelectedRunnerId}
        isExporting={isExporting}
        isTransferring={isTransferring}
        exportProgress={exportProgress}
        embeddingProgress={embeddingProgress}
        onTransfer={() => handleTransferToRunner(activeConnections || [])}
      />

      <DownloadExportCard
        isExporting={isExporting}
        onDownload={handleDownloadExport}
      />

      {lastExportResult && <ExportResultCard result={lastExportResult} />}

      <InfoBanner />
    </div>
  );
}
