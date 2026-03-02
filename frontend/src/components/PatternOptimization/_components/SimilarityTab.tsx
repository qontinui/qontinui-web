"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PatternAnalysis } from "@/types/pattern-optimization";

interface SimilarityTabProps {
  analysis: PatternAnalysis;
}

export function SimilarityTab({ analysis }: SimilarityTabProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Similarity Matrix</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="p-1 text-left text-text-muted">Pattern</th>
                {analysis.extractedPatterns.map((_, i) => (
                  <th key={i} className="p-1 text-center text-text-muted">
                    P{i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {analysis.similarityMatrix.scores.map((row, i) => (
                <tr key={i}>
                  <td className="p-1 text-text-muted">P{i + 1}</td>
                  {row.map((score, j) => (
                    <td
                      key={j}
                      className={cn(
                        "p-1 text-center",
                        i === j && "bg-surface-raised",
                        score >= 0.9 && i !== j && "text-green-500",
                        score < 0.7 && i !== j && "text-red-500"
                      )}
                    >
                      {(score * 100).toFixed(0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-center gap-4 text-xs">
          <span className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500 rounded" />
            High (≥90%)
          </span>
          <span className="flex items-center gap-1">
            <div className="w-3 h-3 bg-yellow-500 rounded" />
            Medium (70-89%)
          </span>
          <span className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded" />
            Low (&lt;70%)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
