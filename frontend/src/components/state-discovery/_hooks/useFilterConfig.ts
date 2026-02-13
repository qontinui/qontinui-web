import { useState } from "react";

export function useFilterConfig() {
  const [maxDarkPixelPercentage, setMaxDarkPixelPercentage] = useState(85);
  const [maxLightPixelPercentage, setMaxLightPixelPercentage] = useState(85);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.95);

  return {
    maxDarkPixelPercentage,
    setMaxDarkPixelPercentage,
    maxLightPixelPercentage,
    setMaxLightPixelPercentage,
    similarityThreshold,
    setSimilarityThreshold,
  };
}
