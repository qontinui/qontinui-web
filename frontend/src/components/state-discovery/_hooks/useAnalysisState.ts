import { useState } from "react";

export function useAnalysisState() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);

  return {
    isAnalyzing,
    setIsAnalyzing,
    analysisProgress,
    setAnalysisProgress,
  };
}
