// components/integration-testing/visualizations/DefineVisualization.tsx

interface DefineVisualizationProps {
  location?: [number, number];
  actionRegion?: { x: number; y: number; w: number; h: number };
  stateName?: string;
}

export function DefineVisualization({
  location,
  actionRegion,
  stateName = 'New State',
}: DefineVisualizationProps) {
  // Determine region - prefer actionRegion, fall back to location-based region
  const region = actionRegion || (location ? {
    x: location[0] - 75,
    y: location[1] - 75,
    w: 150,
    h: 150,
  } : null);

  if (!region) return null;

  const { x, y, w, h } = region;
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  // Corner sparkle positions
  const sparklePositions = [
    { x: x - 15, y: y - 15 }, // Top-left
    { x: x + w + 15, y: y - 15 }, // Top-right
    { x: x - 15, y: y + h + 15 }, // Bottom-left
    { x: x + w + 15, y: y + h + 15 }, // Bottom-right
  ];

  // Sparkle/star path
  const getSparkle = (cx: number, cy: number, size: number) => {
    const points = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const radius = i % 2 === 0 ? size : size / 2.5;
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      points.push(`${px},${py}`);
    }
    return points.join(' ');
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      <defs>
        {/* Glow filter */}
        <filter id="defineGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>

      {/* Outer glow ring */}
      <rect
        x={x - 8}
        y={y - 8}
        width={w + 16}
        height={h + 16}
        fill="none"
        stroke="#6366f1"
        strokeWidth="2"
        opacity="0.4"
        rx="8"
        className="animate-pulse"
      />

      {/* Main dashed border */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(99, 102, 241, 0.1)"
        stroke="#6366f1"
        strokeWidth="4"
        strokeDasharray="12,6"
        rx="6"
        className="animate-pulse"
        filter="url(#defineGlow)"
      />

      {/* Inner border */}
      <rect
        x={x + 4}
        y={y + 4}
        width={w - 8}
        height={h - 8}
        fill="none"
        stroke="#6366f1"
        strokeWidth="1"
        strokeDasharray="6,3"
        opacity="0.6"
        rx="4"
      />

      {/* Corner sparkles */}
      {sparklePositions.map((pos, i) => (
        <g key={i}>
          {/* Outer expanding sparkle */}
          <polygon
            points={getSparkle(pos.x, pos.y, 12)}
            fill="#6366f1"
            opacity="0.6"
            className="animate-ping"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
          {/* Inner sparkle */}
          <polygon
            points={getSparkle(pos.x, pos.y, 8)}
            fill="#6366f1"
            opacity="0.9"
            className="animate-pulse"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
          {/* Center dot */}
          <circle
            cx={pos.x}
            cy={pos.y}
            r="2"
            fill="#fff"
            className="animate-pulse"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        </g>
      ))}

      {/* Radial lines from corners */}
      {[
        { x1: x, y1: y, x2: x + 20, y2: y + 20 },
        { x1: x + w, y1: y, x2: x + w - 20, y2: y + 20 },
        { x1: x, y1: y + h, x2: x + 20, y2: y + h - 20 },
        { x1: x + w, y1: y + h, x2: x + w - 20, y2: y + h - 20 },
      ].map((line, i) => (
        <line
          key={i}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="#6366f1"
          strokeWidth="2"
          opacity="0.5"
          className="animate-pulse"
          style={{ animationDelay: `${i * 0.1}s` }}
        />
      ))}

      {/* DEFINE STATE label */}
      <g transform={`translate(${centerX}, ${y - 30})`}>
        <rect
          x="-65"
          y="-14"
          width="130"
          height="28"
          rx="14"
          fill="#6366f1"
          opacity="0.95"
          filter="url(#defineGlow)"
        />
        <text
          x="0"
          y="5"
          textAnchor="middle"
          fill="#fff"
          fontSize="14"
          fontWeight="700"
        >
          DEFINE STATE
        </text>
      </g>

      {/* State name badge */}
      <g transform={`translate(${centerX}, ${y + h + 35})`}>
        <rect
          x="-80"
          y="-12"
          width="160"
          height="24"
          rx="12"
          fill="#6366f1"
          opacity="0.9"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#fff"
          fontSize="13"
          fontWeight="600"
          className="truncate"
        >
          {stateName.length > 20 ? stateName.substring(0, 20) + '...' : stateName}
        </text>
      </g>

      {/* Center shine/sparkle effect */}
      <g opacity="0.7">
        <polygon
          points={getSparkle(centerX, centerY, 20)}
          fill="none"
          stroke="#6366f1"
          strokeWidth="2"
          className="animate-ping"
        />
        <polygon
          points={getSparkle(centerX, centerY, 15)}
          fill="none"
          stroke="#6366f1"
          strokeWidth="1.5"
          opacity="0.8"
          className="animate-pulse"
        />
      </g>
    </svg>
  );
}
