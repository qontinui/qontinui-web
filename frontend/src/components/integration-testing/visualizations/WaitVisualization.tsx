// components/integration-testing/visualizations/WaitVisualization.tsx

interface WaitVisualizationProps {
  location?: [number, number];
  actionRegion?: { x: number; y: number; w: number; h: number };
  duration?: number; // in milliseconds
}

export function WaitVisualization({
  location,
  actionRegion,
  duration = 1000,
}: WaitVisualizationProps) {
  // Determine center point
  let centerX: number;
  let centerY: number;

  if (actionRegion) {
    centerX = actionRegion.x + actionRegion.w / 2;
    centerY = actionRegion.y + actionRegion.h / 2;
  } else if (location) {
    centerX = location[0];
    centerY = location[1];
  } else {
    // Default to center of screen
    centerX = 400;
    centerY = 300;
  }

  // Format duration for display
  const formatDuration = (ms: number): string => {
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    return `${ms}ms`;
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      {/* Expanding circles */}
      <circle
        cx={centerX}
        cy={centerY}
        r="60"
        fill="none"
        stroke="#64748b"
        strokeWidth="3"
        opacity="0.6"
        className="animate-ping"
      />
      <circle
        cx={centerX}
        cy={centerY}
        r="45"
        fill="none"
        stroke="#64748b"
        strokeWidth="2.5"
        opacity="0.7"
        className="animate-ping"
        style={{ animationDelay: "0.2s" }}
      />
      <circle
        cx={centerX}
        cy={centerY}
        r="30"
        fill="none"
        stroke="#64748b"
        strokeWidth="2"
        opacity="0.8"
        className="animate-ping"
        style={{ animationDelay: "0.4s" }}
      />

      {/* Central clock icon background */}
      <circle
        cx={centerX}
        cy={centerY}
        r="35"
        fill="#64748b"
        opacity="0.2"
        className="animate-pulse"
      />
      <circle cx={centerX} cy={centerY} r="25" fill="#64748b" opacity="0.9" />

      {/* Clock face */}
      <circle
        cx={centerX}
        cy={centerY}
        r="20"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
      />

      {/* Clock hour markers */}
      {[0, 90, 180, 270].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x = centerX + Math.cos(rad) * 15;
        const y = centerY + Math.sin(rad) * 15;
        return <circle key={i} cx={x} cy={y} r="1.5" fill="#fff" />;
      })}

      {/* Clock hands */}
      {/* Hour hand */}
      <line
        x1={centerX}
        y1={centerY}
        x2={centerX + 8}
        y2={centerY - 8}
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Minute hand */}
      <line
        x1={centerX}
        y1={centerY}
        x2={centerX}
        y2={centerY - 14}
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        className="animate-pulse"
      />
      {/* Center dot */}
      <circle cx={centerX} cy={centerY} r="2.5" fill="#fff" />

      {/* WAIT label */}
      <g transform={`translate(${centerX}, ${centerY - 60})`}>
        <rect
          x="-35"
          y="-14"
          width="70"
          height="28"
          rx="14"
          fill="#64748b"
          opacity="0.95"
        />
        <text
          x="0"
          y="5"
          textAnchor="middle"
          fill="#fff"
          fontSize="14"
          fontWeight="700"
        >
          WAIT
        </text>
      </g>

      {/* Duration display */}
      <g transform={`translate(${centerX}, ${centerY + 55})`}>
        <rect
          x="-40"
          y="-12"
          width="80"
          height="24"
          rx="12"
          fill="#64748b"
          opacity="0.9"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#fff"
          fontSize="13"
          fontWeight="600"
        >
          {formatDuration(duration)}
        </text>
      </g>
    </svg>
  );
}
