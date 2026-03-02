import type {
  RAGExportRequest,
  RAGExportStatus,
  EmbeddingProgress,
} from "@/services/rag-export-service";
import type { RunnerConnection } from "@/types/runner";

export interface ExportResult {
  success: boolean;
  message: string;
  elementCount?: number;
  exportSize?: number;
}

export interface UseRagExportReturn {
  exportStatus: RAGExportStatus | null;
  isLoadingStatus: boolean;
  isExporting: boolean;
  isTransferring: boolean;
  exportProgress: number;
  embeddingProgress: EmbeddingProgress | null;
  lastExportResult: ExportResult | null;
  options: RAGExportRequest;
  setOptions: React.Dispatch<React.SetStateAction<RAGExportRequest>>;
  selectedRunnerId: string | null;
  setSelectedRunnerId: (id: string | null) => void;
  handleDownloadExport: () => Promise<void>;
  handleTransferToRunner: (connections: RunnerConnection[]) => Promise<void>;
}
