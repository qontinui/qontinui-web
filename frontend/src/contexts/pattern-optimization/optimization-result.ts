import type {
  OptimizationSession,
  OptimizationResult,
} from "@/types/pattern-optimization";

export async function generateOptimizationResult(
  session: OptimizationSession,
  selectedPatternIds?: Set<string>
): Promise<OptimizationResult> {
  if (!session.selectedStrategy || !session.analysis) {
    throw new Error("No strategy or analysis available");
  }

  let patternsToUse = session.analysis.extractedPatterns;
  if (selectedPatternIds && selectedPatternIds.size > 0) {
    patternsToUse = session.analysis.extractedPatterns.filter((p) =>
      selectedPatternIds.has(p.id)
    );
  }

  const patterns = patternsToUse.map((pattern) => ({
    id: pattern.id,
    image_data: pattern.imageUrl?.split(",")[1] || "",
    region: pattern.region,
  }));

  const response = await fetch(
    "http://127.0.0.1:9876/api/v1/create-state-image",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `StateImage_${session.id}`,
        patterns: patterns,
        strategy_type: session.selectedStrategy.type,
        similarity_threshold:
          session.selectedStrategy.parameters?.threshold || 0.8,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create StateImage: ${response.statusText}`);
  }

  await response.json();

  return {
    sessionId: session.id,
    patterns: session.analysis.extractedPatterns,
    strategy: session.selectedStrategy,
    createdAt: new Date(),
  };
}

export function exportOptimizationResult(result: OptimizationResult): void {
  const dataStr = JSON.stringify(result, null, 2);
  const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

  const exportFileDefaultName = `pattern-optimization-${result.sessionId}.json`;

  const linkElement = document.createElement("a");
  linkElement.setAttribute("href", dataUri);
  linkElement.setAttribute("download", exportFileDefaultName);
  linkElement.click();
}
