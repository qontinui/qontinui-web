import type {
  ExtractedPattern,
  PatternQuality,
} from "@/types/pattern-optimization";

export function analyzePatternQuality(
  pattern: ExtractedPattern
): PatternQuality {
  const density = pattern.maskDensity;
  const avgConf = pattern.avgConfidence;
  const stdDev = pattern.stdDevConfidence;

  let score = 0;
  const recommendations: string[] = [];

  // Density score (ideal: 30-80%)
  if (density >= 0.3 && density <= 0.8) {
    score += 30;
  } else if (density >= 0.2 && density <= 0.9) {
    score += 20;
  } else if (density >= 0.1 && density <= 0.95) {
    score += 10;
  }

  if (density < 0.1) {
    recommendations.push(
      "Pattern has very low mask density - consider lowering similarity threshold"
    );
  } else if (density > 0.9) {
    recommendations.push(
      "Pattern has very high mask density - may be too general"
    );
  }

  // Confidence score
  if (avgConf >= 0.9) score += 40;
  else if (avgConf >= 0.8) score += 30;
  else if (avgConf >= 0.7) score += 20;
  else if (avgConf >= 0.6) score += 10;

  if (avgConf < 0.7) {
    recommendations.push(
      "Low average confidence - screenshots may be too different"
    );
  }

  // Variance score (lower is better)
  if (stdDev <= 0.1) score += 30;
  else if (stdDev <= 0.2) score += 20;
  else if (stdDev <= 0.3) score += 10;

  if (stdDev > 0.3) {
    recommendations.push(
      "High confidence variance - pattern may be inconsistent"
    );
  }

  // Determine rating
  let rating: PatternQuality["rating"];
  if (score >= 80) rating = "excellent";
  else if (score >= 60) rating = "good";
  else if (score >= 40) rating = "fair";
  else rating = "poor";

  if (rating === "excellent" && recommendations.length === 0) {
    recommendations.push("Pattern quality is excellent!");
  }

  return { rating, score, recommendations };
}
