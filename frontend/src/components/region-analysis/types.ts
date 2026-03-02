import type {
  RegionAnalyzerInfo,
  RegionAnalysisResponse,
} from "@/services/regionAnalysis";

export interface RegionAnalysisPanelProps {
  annotationSetId: string;
  token: string;
  onAnalysisComplete?: (results: RegionAnalysisResponse) => void;
}

export interface AnalyzerSelectorProps {
  analyzers: RegionAnalyzerInfo[];
  selectedAnalyzers: Set<string>;
  analyzerConfigs: Record<string, Record<string, unknown>>;
  onToggleAnalyzer: (name: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onUpdateConfig: (analyzerName: string, param: string, value: unknown) => void;
}

export interface AnalysisOptionsProps {
  fuseResults: boolean;
  onFuseResultsChange: (value: boolean) => void;
  overlapThreshold: number;
  onOverlapThresholdChange: (value: number) => void;
  runInParallel: boolean;
  onRunInParallelChange: (value: boolean) => void;
  saveToDatabase: boolean;
  onSaveToDatabaseChange: (value: boolean) => void;
}

export interface AnalysisActionsProps {
  isRunning: boolean;
  selectedCount: number;
  onRunAnalysis: () => void;
  onQuickAnalysis: () => void;
}
