// components/integration-testing/visualizations/FindVisualization.tsx

interface FindVisualizationProps {
  matches: Array<{ x: number; y: number; w: number; h: number; score: number }>;
  actionRegion?: { x: number; y: number; w: number; h: number };
}

export function FindVisualization({
  matches,
  actionRegion,
}: FindVisualizationProps) {
  return (
    <svg className="absolute inset-0 pointer-events-none w-full h-full">
      {/* Draw all match regions */}
      {matches.map((match, i) => (
        <g key={i}>
          {/* Match rectangle */}
          <rect
            x={match.x}
            y={match.y}
            width={match.w}
            height={match.h}
            fill="none"
            stroke={i === 0 ? "#10b981" : "#eab308"}
            strokeWidth="2"
            strokeDasharray={i === 0 ? "0" : "5,5"}
            className="animate-pulse"
          />

          {/* Score label */}
          <text
            x={match.x + 4}
            y={match.y + 16}
            fill={i === 0 ? "#10b981" : "#eab308"}
            fontSize="12"
            fontWeight="bold"
          >
            {Math.round(match.score * 100)}%
          </text>
        </g>
      ))}

      {/* Highlight primary match region */}
      {actionRegion && (
        <rect
          x={actionRegion.x}
          y={actionRegion.y}
          width={actionRegion.w}
          height={actionRegion.h}
          fill="rgba(16, 185, 129, 0.1)"
          stroke="#10b981"
          strokeWidth="3"
        />
      )}
    </svg>
  );
}
