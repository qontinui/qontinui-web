// components/integration-testing/visualizations/VanishVisualization.tsx

interface VanishVisualizationProps {
  location?: [number, number];
  actionRegion?: { x: number; y: number; w: number; h: number };
  stateName?: string;
}

export function VanishVisualization({
  location,
  actionRegion,
  stateName = 'State',
}: VanishVisualizationProps) {
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

  // Ghost icon path (simplified ghost shape)
  const getGhostPath = (cx: number, cy: number, size: number) => {
    const halfSize = size / 2;
    return `
      M ${cx - halfSize},${cy}
      Q ${cx - halfSize},${cy - halfSize} ${cx},${cy - halfSize}
      Q ${cx + halfSize},${cy - halfSize} ${cx + halfSize},${cy}
      L ${cx + halfSize},${cy + halfSize - 8}
      L ${cx + halfSize - 8},${cy + halfSize}
      L ${cx + halfSize - 16},${cy + halfSize - 8}
      L ${cx + halfSize - 24},${cy + halfSize}
      L ${cx + halfSize - 32},${cy + halfSize - 8}
      L ${cx - halfSize},${cy + halfSize - 8}
      Z
    `;
  };

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      <defs>
        {/* Fade animation keyframes */}
        <style>
          {`
            @keyframes fadeDisappear {
              0%, 30% { opacity: 1; }
              100% { opacity: 0; }
            }
            .vanish-fade {
              animation: fadeDisappear 3s ease-in-out infinite;
            }
          `}
        </style>
      </defs>

      {/* Fading outer glow */}
      <rect
        x={x - 6}
        y={y - 6}
        width={w + 12}
        height={h + 12}
        fill="none"
        stroke="#f43f5e"
        strokeWidth="3"
        opacity="0.3"
        rx="8"
        className="animate-pulse"
      />

      {/* Main crossed-out region */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="rgba(244, 63, 94, 0.15)"
        stroke="#f43f5e"
        strokeWidth="3"
        strokeDasharray="10,5"
        rx="6"
        className="vanish-fade"
      />

      {/* X mark - diagonal lines */}
      <line
        x1={x + 10}
        y1={y + 10}
        x2={x + w - 10}
        y2={y + h - 10}
        stroke="#f43f5e"
        strokeWidth="5"
        strokeLinecap="round"
        className="vanish-fade"
      />
      <line
        x1={x + w - 10}
        y1={y + 10}
        x2={x + 10}
        y2={y + h - 10}
        stroke="#f43f5e"
        strokeWidth="5"
        strokeLinecap="round"
        className="vanish-fade"
      />

      {/* Additional X mark outline for emphasis */}
      <line
        x1={x + 10}
        y1={y + 10}
        x2={x + w - 10}
        y2={y + h - 10}
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
        className="vanish-fade"
      />
      <line
        x1={x + w - 10}
        y1={y + 10}
        x2={x + 10}
        y2={y + h - 10}
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.5"
        className="vanish-fade"
      />

      {/* Ghost icon */}
      <g className="vanish-fade">
        <path
          d={getGhostPath(centerX, centerY - 20, 40)}
          fill="#f43f5e"
          opacity="0.8"
          stroke="#fff"
          strokeWidth="2"
        />
        {/* Ghost eyes */}
        <circle cx={centerX - 8} cy={centerY - 24} r="3" fill="#fff" />
        <circle cx={centerX + 8} cy={centerY - 24} r="3" fill="#fff" />
      </g>

      {/* Fade-out particles */}
      {[...Array(8)].map((_, i) => {
        const angle = (i * Math.PI * 2) / 8;
        const distance = 40 + i * 5;
        const px = centerX + Math.cos(angle) * distance;
        const py = centerY + Math.sin(angle) * distance;
        return (
          <circle
            key={i}
            cx={px}
            cy={py}
            r="4"
            fill="#f43f5e"
            opacity="0.6"
            className="animate-ping"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        );
      })}

      {/* VANISH label */}
      <g transform={`translate(${centerX}, ${y - 30})`}>
        <rect
          x="-45"
          y="-14"
          width="90"
          height="28"
          rx="14"
          fill="#f43f5e"
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
          VANISH
        </text>
      </g>

      {/* State name being removed */}
      <g transform={`translate(${centerX}, ${y + h + 35})`} className="vanish-fade">
        <rect
          x="-80"
          y="-12"
          width="160"
          height="24"
          rx="12"
          fill="#f43f5e"
          opacity="0.9"
        />
        {/* Strike-through line */}
        <line
          x1="-75"
          y1="0"
          x2="75"
          y2="0"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#fff"
          fontSize="13"
          fontWeight="600"
        >
          {stateName.length > 20 ? stateName.substring(0, 20) + '...' : stateName}
        </text>
      </g>

      {/* Expanding fade circles */}
      <circle
        cx={centerX}
        cy={centerY}
        r="50"
        fill="none"
        stroke="#f43f5e"
        strokeWidth="2"
        opacity="0.4"
        className="animate-ping"
      />
      <circle
        cx={centerX}
        cy={centerY}
        r="70"
        fill="none"
        stroke="#f43f5e"
        strokeWidth="1.5"
        opacity="0.3"
        className="animate-ping"
        style={{ animationDelay: '0.3s' }}
      />
    </svg>
  );
}
