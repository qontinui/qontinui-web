import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  listRegionAnalyzers,
  runRegionAnalysis,
  runQuickRegionAnalysis,
  type RegionAnalyzerInfo,
  type RegionAnalysisResponse,
} from "@/services/regionAnalysis";

interface UseRegionAnalysisPanelParams {
  annotationSetId: string;
  token: string;
  onAnalysisComplete?: (results: RegionAnalysisResponse) => void;
}

export function useRegionAnalysisPanel({
  annotationSetId,
  token,
  onAnalysisComplete,
}: UseRegionAnalysisPanelParams) {
  const [analyzers, setAnalyzers] = useState<RegionAnalyzerInfo[]>([]);
  const [selectedAnalyzers, setSelectedAnalyzers] = useState<Set<string>>(
    new Set()
  );
  const [analyzerConfigs, setAnalyzerConfigs] = useState<
    Record<string, Record<string, unknown>>
  >({});
  const [isLoadingAnalyzers, setIsLoadingAnalyzers] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [fuseResults, setFuseResults] = useState(true);
  const [saveToDatabase, setSaveToDatabase] = useState(true);
  const [overlapThreshold, setOverlapThreshold] = useState(0.5);
  const [runInParallel, setRunInParallel] = useState(true);

  useEffect(() => {
    const loadAnalyzers = async () => {
      try {
        setIsLoadingAnalyzers(true);
        const data = await listRegionAnalyzers(token);
        setAnalyzers(data);
        setSelectedAnalyzers(new Set(data.map((a) => a.name)));
        const configs: Record<string, Record<string, unknown>> = {};
        data.forEach((analyzer) => {
          configs[analyzer.name] = { ...analyzer.default_parameters };
        });
        setAnalyzerConfigs(configs);
      } catch (error) {
        console.error("Error loading region analyzers:", error);
        toast.error("Failed to load region analyzers");
      } finally {
        setIsLoadingAnalyzers(false);
      }
    };
    loadAnalyzers();
  }, [token]);

  const toggleAnalyzer = (name: string) => {
    const newSelected = new Set(selectedAnalyzers);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedAnalyzers(newSelected);
  };

  const selectAll = () => {
    setSelectedAnalyzers(new Set(analyzers.map((a) => a.name)));
  };

  const clearAll = () => {
    setSelectedAnalyzers(new Set());
  };

  const updateAnalyzerConfig = (
    analyzerName: string,
    param: string,
    value: unknown
  ) => {
    setAnalyzerConfigs((prev) => ({
      ...prev,
      [analyzerName]: {
        ...prev[analyzerName],
        [param]: value,
      },
    }));
  };

  const handleRunAnalysis = async () => {
    if (selectedAnalyzers.size === 0) {
      toast.error("Please select at least one analyzer");
      return;
    }

    try {
      setIsRunning(true);
      const results = await runRegionAnalysis(
        {
          annotation_set_id: annotationSetId,
          analyzer_names: Array.from(selectedAnalyzers),
          analyzer_configs: analyzerConfigs,
          parallel: runInParallel,
          fuse_results: fuseResults,
          overlap_threshold: overlapThreshold,
          save_to_database: saveToDatabase,
        },
        token
      );

      const regionCount = results.fused_regions?.length || 0;
      const gridCellCount = results.fusion_stats?.total_grid_cells || 0;
      let message = `Analysis complete! Found ${regionCount} region${regionCount !== 1 ? "s" : ""}`;
      if (gridCellCount > 0) {
        message += ` with ${gridCellCount} grid cell${gridCellCount !== 1 ? "s" : ""}`;
      }
      toast.success(message);
      onAnalysisComplete?.(results);
    } catch (error) {
      console.error("Error running region analysis:", error);
      toast.error("Region analysis failed: " + (error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  const handleQuickAnalysis = async () => {
    if (selectedAnalyzers.size === 0) {
      toast.error("Please select at least one analyzer");
      return;
    }

    try {
      setIsRunning(true);
      const results = await runQuickRegionAnalysis(
        {
          annotation_set_id: annotationSetId,
          analyzers: Array.from(selectedAnalyzers),
          fuse_results: fuseResults,
        },
        token
      );
      toast.success("Quick region analysis complete!");
      onAnalysisComplete?.(results);
    } catch (error) {
      console.error("Error running quick region analysis:", error);
      toast.error("Quick region analysis failed");
    } finally {
      setIsRunning(false);
    }
  };

  return {
    analyzers,
    selectedAnalyzers,
    analyzerConfigs,
    isLoadingAnalyzers,
    isRunning,
    fuseResults,
    setFuseResults,
    saveToDatabase,
    setSaveToDatabase,
    overlapThreshold,
    setOverlapThreshold,
    runInParallel,
    setRunInParallel,
    toggleAnalyzer,
    selectAll,
    clearAll,
    updateAnalyzerConfig,
    handleRunAnalysis,
    handleQuickAnalysis,
  };
}
