"use client";

import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import type { HealthFactors } from "../_lib/types";

interface HealthScoreGaugeProps {
  score: number;
  factors: HealthFactors;
}

export function HealthScoreGauge({ score, factors }: HealthScoreGaugeProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return "var(--brand-success)";
    if (score >= 60) return "var(--warning)";
    return "var(--error)";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return "Excellent";
    if (score >= 75) return "Good";
    if (score >= 60) return "Fair";
    if (score >= 40) return "Poor";
    return "Critical";
  };

  const color = getScoreColor(score);
  const label = getScoreLabel(score);

  const radarData = [
    { factor: "Tests", value: factors.testCoverage, fullMark: 100 },
    { factor: "Docs", value: factors.docCoverage, fullMark: 100 },
    { factor: "Organized", value: factors.organization, fullMark: 100 },
    { factor: "Complexity", value: factors.complexity, fullMark: 100 },
    { factor: "Unused", value: factors.unusedResources, fullMark: 100 },
    { factor: "References", value: factors.brokenReferences, fullMark: 100 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center">
        <div className="relative w-40 h-40">
          <svg className="w-full h-full transform -rotate-90">
            <circle
              cx="80"
              cy="80"
              r="70"
              stroke="var(--surface-raised)"
              strokeWidth="12"
              fill="none"
            />
            <circle
              cx="80"
              cy="80"
              r="70"
              stroke={color}
              strokeWidth="12"
              fill="none"
              strokeDasharray={`${(score / 100) * 439.82} 439.82`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-4xl font-bold" style={{ color }}>
              {score}
            </p>
            <p className="text-xs text-text-muted">out of 100</p>
          </div>
        </div>
        <p className="mt-3 text-lg font-semibold" style={{ color }}>
          {label}
        </p>
      </div>

      <div className="mt-6">
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#333" />
            <PolarAngleAxis
              dataKey="factor"
              stroke="#888"
              style={{ fontSize: "11px" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              stroke="#666"
              style={{ fontSize: "10px" }}
            />
            <Radar
              name="Score"
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Test Coverage</span>
          <span className="font-medium">
            {factors.testCoverage.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Documentation</span>
          <span className="font-medium">{factors.docCoverage.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Organization</span>
          <span className="font-medium">
            {factors.organization.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Complexity</span>
          <span className="font-medium">{factors.complexity.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Clean Resources</span>
          <span className="font-medium">
            {factors.unusedResources.toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-muted">Valid References</span>
          <span className="font-medium">
            {factors.brokenReferences.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
