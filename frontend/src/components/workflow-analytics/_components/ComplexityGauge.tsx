import React from "react";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";
import { getComplexityColor } from "../workflow-metrics-panel-utils";

interface ComplexityGaugeProps {
  score: number;
  rating: string;
}

export function ComplexityGauge({ score, rating }: ComplexityGaugeProps) {
  const data = [
    {
      name: "Complexity",
      value: score,
      fill: getComplexityColor(rating),
    },
  ];

  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width="100%" height={200}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="60%"
          outerRadius="90%"
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar background dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="text-center -mt-20">
        <div className="text-3xl font-bold">{score}</div>
        <div className="text-sm text-muted-foreground uppercase">{rating}</div>
      </div>
    </div>
  );
}
