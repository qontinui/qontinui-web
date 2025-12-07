// components/integration-testing/visualizations/TypeVisualization.tsx

interface TypeVisualizationProps {
  location?: [number, number];
  text: string;
}

export function TypeVisualization({ location, text }: TypeVisualizationProps) {
  if (!location) return null;

  const [x, y] = location;

  return (
    <>
      {/* Cursor indicator */}
      <svg className="absolute inset-0 pointer-events-none w-full h-full">
        <line
          x1={x}
          y1={y - 10}
          x2={x}
          y2={y + 10}
          stroke="#3b82f6"
          strokeWidth="3"
          className="animate-pulse"
        />
      </svg>

      {/* Text bubble */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: `${x}px`,
          top: `${y + 30}px`,
          transform: "translateX(-50%)",
        }}
      >
        <div className="bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg max-w-xs">
          <div className="font-mono text-sm">
            {text}
            <span className="animate-blink">|</span>
          </div>
        </div>

        {/* Arrow pointing to cursor */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2">
          <div className="w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-blue-500" />
        </div>
      </div>
    </>
  );
}
