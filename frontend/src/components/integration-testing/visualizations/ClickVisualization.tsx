// components/integration-testing/visualizations/ClickVisualization.tsx

interface ClickVisualizationProps {
  location?: [number, number];
}

export function ClickVisualization({ location }: ClickVisualizationProps) {
  if (!location) return null;

  const [x, y] = location;

  return (
    <svg className="absolute inset-0 pointer-events-none w-full h-full">
      {/* Outer ripple */}
      <circle
        cx={x}
        cy={y}
        r="20"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        className="animate-ping"
      />

      {/* Middle ripple */}
      <circle
        cx={x}
        cy={y}
        r="12"
        fill="none"
        stroke="#ef4444"
        strokeWidth="2"
        className="animate-pulse"
      />

      {/* Center dot */}
      <circle
        cx={x}
        cy={y}
        r="6"
        fill="#ef4444"
      />

      {/* Crosshair */}
      <line
        x1={x - 15}
        y1={y}
        x2={x - 8}
        y2={y}
        stroke="#ef4444"
        strokeWidth="2"
      />
      <line
        x1={x + 8}
        y1={y}
        x2={x + 15}
        y2={y}
        stroke="#ef4444"
        strokeWidth="2"
      />
      <line
        x1={x}
        y1={y - 15}
        x2={x}
        y2={y - 8}
        stroke="#ef4444"
        strokeWidth="2"
      />
      <line
        x1={x}
        y1={y + 8}
        x2={x}
        y2={y + 15}
        stroke="#ef4444"
        strokeWidth="2"
      />
    </svg>
  );
}
