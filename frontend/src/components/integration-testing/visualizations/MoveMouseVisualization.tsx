// components/integration-testing/visualizations/MoveMouseVisualization.tsx

interface MoveMouseVisualizationProps {
  location?: [number, number];
}

export function MoveMouseVisualization({
  location,
}: MoveMouseVisualizationProps) {
  if (!location) return null;

  const [x, y] = location;

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      {/* Trail effect - multiple circles fading out */}
      <circle
        cx={x}
        cy={y}
        r="30"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="2"
        opacity="0.3"
        className="animate-ping"
      />
      <circle
        cx={x}
        cy={y}
        r="20"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="2"
        opacity="0.5"
        className="animate-ping"
        style={{ animationDelay: "0.2s" }}
      />

      {/* Cursor shape - arrow pointer */}
      <g transform={`translate(${x}, ${y})`}>
        {/* Cursor shadow */}
        <path
          d="M 2 2 L 2 16 L 6 12 L 9 18 L 11 17 L 8 11 L 14 11 Z"
          fill="rgba(0,0,0,0.3)"
        />
        {/* Cursor body */}
        <path
          d="M 0 0 L 0 14 L 4 10 L 7 16 L 9 15 L 6 9 L 12 9 Z"
          fill="#8b5cf6"
          stroke="white"
          strokeWidth="1"
        />
      </g>

      {/* Direction indicator - small arrow showing movement */}
      <g transform={`translate(${x + 20}, ${y - 20})`}>
        <circle cx="0" cy="0" r="12" fill="#8b5cf6" opacity="0.8" />
        <path
          d="M -4 0 L 4 0 M 4 0 L 0 -4 M 4 0 L 0 4"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Coordinates label */}
      <g transform={`translate(${x + 15}, ${y + 25})`}>
        <rect
          x="-25"
          y="-10"
          width="50"
          height="20"
          rx="4"
          fill="#8b5cf6"
          opacity="0.9"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontWeight="600"
        >
          {x}, {y}
        </text>
      </g>
    </svg>
  );
}
