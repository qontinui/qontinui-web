// components/integration-testing/visualizations/HighlightVisualization.tsx

interface HighlightVisualizationProps {
  actionRegion?: { x: number; y: number; w: number; h: number };
  location?: [number, number];
}

export function HighlightVisualization({
  actionRegion,
  location,
}: HighlightVisualizationProps) {
  // Prefer region over location
  const region = actionRegion || (location ? {
    x: location[0] - 50,
    y: location[1] - 50,
    w: 100,
    h: 100,
  } : null);

  if (!region) return null;

  const { x, y, w, h } = region;
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      {/* Animated spotlight effect - expanding circles */}
      <circle
        cx={centerX}
        cy={centerY}
        r={Math.max(w, h) / 2 + 20}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="3"
        opacity="0.6"
        className="animate-ping"
      />
      <circle
        cx={centerX}
        cy={centerY}
        r={Math.max(w, h) / 2 + 10}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2"
        opacity="0.8"
        className="animate-pulse"
      />

      {/* Main highlight box */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(251, 191, 36, 0.15)"
        stroke="#fbbf24"
        strokeWidth="4"
        strokeDasharray="10,5"
        className="animate-pulse"
        rx="4"
      />

      {/* Corner markers */}
      {[
        { x: x, y: y }, // Top-left
        { x: x + w, y: y }, // Top-right
        { x: x, y: y + h }, // Bottom-left
        { x: x + w, y: y + h }, // Bottom-right
      ].map((corner, i) => (
        <g key={i}>
          <circle
            cx={corner.x}
            cy={corner.y}
            r="6"
            fill="#fbbf24"
            className="animate-pulse"
          />
          <circle
            cx={corner.x}
            cy={corner.y}
            r="10"
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2"
            className="animate-ping"
          />
        </g>
      ))}

      {/* Spotlight beam effect - radial lines */}
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const length = Math.max(w, h) / 2 + 30;
        const x1 = centerX + Math.cos(rad) * (Math.max(w, h) / 2);
        const y1 = centerY + Math.sin(rad) * (Math.max(w, h) / 2);
        const x2 = centerX + Math.cos(rad) * length;
        const y2 = centerY + Math.sin(rad) * length;

        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#fbbf24"
            strokeWidth="2"
            opacity="0.4"
            className="animate-pulse"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        );
      })}

      {/* Label */}
      <g transform={`translate(${centerX}, ${y - 20})`}>
        <rect
          x="-45"
          y="-12"
          width="90"
          height="24"
          rx="12"
          fill="#fbbf24"
          opacity="0.95"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#000"
          fontSize="13"
          fontWeight="700"
        >
          HIGHLIGHT
        </text>
      </g>

      {/* Dimension labels */}
      <g opacity="0.8">
        {/* Width label */}
        <rect
          x={x + w / 2 - 25}
          y={y + h + 10}
          width="50"
          height="18"
          rx="3"
          fill="#fbbf24"
        />
        <text
          x={x + w / 2}
          y={y + h + 23}
          textAnchor="middle"
          fill="#000"
          fontSize="11"
          fontWeight="600"
        >
          {w}px
        </text>

        {/* Height label */}
        <rect
          x={x - 60}
          y={y + h / 2 - 9}
          width="50"
          height="18"
          rx="3"
          fill="#fbbf24"
        />
        <text
          x={x - 35}
          y={y + h / 2 + 4}
          textAnchor="middle"
          fill="#000"
          fontSize="11"
          fontWeight="600"
        >
          {h}px
        </text>
      </g>
    </svg>
  );
}
