// components/integration-testing/visualizations/ScrollVisualization.tsx

interface ScrollVisualizationProps {
  location?: [number, number];
  actionRegion?: { x: number; y: number; w: number; h: number };
  direction?: string;
  amount?: number;
}

export function ScrollVisualization({
  location,
  actionRegion,
  direction = 'down',
  amount = 1,
}: ScrollVisualizationProps) {
  // Determine center point - prefer region center, fall back to location or screen center
  let centerX: number;
  let centerY: number;
  let width: number;
  let height: number;

  if (actionRegion) {
    centerX = actionRegion.x + actionRegion.w / 2;
    centerY = actionRegion.y + actionRegion.h / 2;
    width = actionRegion.w;
    height = actionRegion.h;
  } else if (location) {
    centerX = location[0];
    centerY = location[1];
    width = 200;
    height = 200;
  } else {
    // Default to center of screen
    centerX = 400;
    centerY = 300;
    width = 200;
    height = 200;
  }

  // Determine arrow orientation based on direction
  const getArrowPath = (offsetY: number) => {
    const arrowSize = 30;
    switch (direction.toLowerCase()) {
      case 'down':
        return `M ${centerX - arrowSize},${centerY - arrowSize + offsetY} L ${centerX},${centerY + offsetY} L ${centerX + arrowSize},${centerY - arrowSize + offsetY}`;
      case 'up':
        return `M ${centerX - arrowSize},${centerY + arrowSize + offsetY} L ${centerX},${centerY + offsetY} L ${centerX + arrowSize},${centerY + arrowSize + offsetY}`;
      case 'left':
        return `M ${centerX + arrowSize + offsetY},${centerY - arrowSize} L ${centerX + offsetY},${centerY} L ${centerX + arrowSize + offsetY},${centerY + arrowSize}`;
      case 'right':
        return `M ${centerX - arrowSize + offsetY},${centerY - arrowSize} L ${centerX + offsetY},${centerY} L ${centerX - arrowSize + offsetY},${centerY + arrowSize}`;
      default:
        return `M ${centerX - arrowSize},${centerY - arrowSize + offsetY} L ${centerX},${centerY + offsetY} L ${centerX + arrowSize},${centerY - arrowSize + offsetY}`;
    }
  };

  // Gradient direction based on scroll direction
  const getGradientId = () => `scrollGradient-${direction}`;
  const gradientStops = () => {
    switch (direction.toLowerCase()) {
      case 'down':
        return { x1: '50%', y1: '0%', x2: '50%', y2: '100%' };
      case 'up':
        return { x1: '50%', y1: '100%', x2: '50%', y2: '0%' };
      case 'left':
        return { x1: '100%', y1: '50%', x2: '0%', y2: '50%' };
      case 'right':
        return { x1: '0%', y1: '50%', x2: '100%', y2: '50%' };
      default:
        return { x1: '50%', y1: '0%', x2: '50%', y2: '100%' };
    }
  };

  const gradient = gradientStops();
  const labelY = direction.toLowerCase() === 'down' ? centerY - height / 2 - 40 :
                 direction.toLowerCase() === 'up' ? centerY + height / 2 + 40 :
                 centerY - height / 2 - 40;

  return (
    <svg
      className="absolute inset-0 pointer-events-none w-full h-full"
      style={{ zIndex: 10 }}
    >
      <defs>
        <linearGradient id={getGradientId()} {...gradient}>
          <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Gradient overlay showing scroll direction */}
      {actionRegion && (
        <rect
          x={actionRegion.x}
          y={actionRegion.y}
          width={actionRegion.w}
          height={actionRegion.h}
          fill={`url(#${getGradientId()})`}
          rx="4"
        />
      )}

      {/* Animated arrows */}
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={getArrowPath(i * 40 - 80)}
          fill="none"
          stroke="#14b8a6"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={1 - i * 0.2}
          className="animate-pulse"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}

      {/* Label */}
      <g transform={`translate(${centerX}, ${labelY})`}>
        <rect
          x="-60"
          y="-14"
          width="120"
          height="28"
          rx="14"
          fill="#14b8a6"
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
          SCROLL {direction.toUpperCase()}
        </text>
      </g>

      {/* Amount indicator */}
      <g transform={`translate(${centerX}, ${labelY + 35})`}>
        <rect
          x="-35"
          y="-10"
          width="70"
          height="20"
          rx="10"
          fill="#14b8a6"
          opacity="0.8"
        />
        <text
          x="0"
          y="4"
          textAnchor="middle"
          fill="#fff"
          fontSize="12"
          fontWeight="600"
        >
          {amount} {amount === 1 ? 'unit' : 'units'}
        </text>
      </g>

      {/* Border around region if available */}
      {actionRegion && (
        <rect
          x={actionRegion.x}
          y={actionRegion.y}
          width={actionRegion.w}
          height={actionRegion.h}
          fill="none"
          stroke="#14b8a6"
          strokeWidth="3"
          strokeDasharray="8,4"
          rx="4"
          className="animate-pulse"
        />
      )}
    </svg>
  );
}
