import type { RAGSetupProgress } from "@/services/rag-setup-service";
import type { CleanupResult } from "@/services/project-optimization/reference-cleaner";
import type { MonitorValidationError } from "@/lib/monitor-validation";
import type { MonitorUpdate } from "@/components/export/MissingMonitorsDialog";

export type RagStatus =
  | "idle"
  | "checking"
  | "processing"
  | "completed"
  | "failed"
  | "skipped";

export interface ProjectExportState {
  isExporting: boolean;
  isFixing: boolean;
  exportName: string;
  description: string;
  validationErrors: string[];
  cleanupResult: CleanupResult | null;
  monitorValidationErrors: MonitorValidationError[];
  showMonitorDialog: boolean;
  ragStatus: RagStatus;
  ragProgress: RAGSetupProgress | null;
  ragError: string | null;
  configLoaded: boolean;
  configLoadError: string | null;
}

export interface ProjectExportActions {
  setExportName: (name: string) => void;
  setDescription: (desc: string) => void;
  setShowMonitorDialog: (show: boolean) => void;
  handleExport: (loadToRunner?: boolean) => Promise<void>;
  handleFixIssues: () => Promise<void>;
  handleApplyMonitorUpdates: (updates: MonitorUpdate[]) => void;
}

export interface UseProjectExportReturn
  extends ProjectExportState, ProjectExportActions {}
