import type { SpotlightPosition } from "../types";

interface TutorialSpotlightProps {
  spotlightPos: SpotlightPosition;
}

export function TutorialSpotlight({ spotlightPos }: TutorialSpotlightProps) {
  return (
    <>
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ mixBlendMode: "hard-light" }}
      >
        <defs>
          <mask id="spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={spotlightPos.left}
              y={spotlightPos.top}
              width={spotlightPos.width}
              height={spotlightPos.height}
              rx="8"
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.4)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      <div
        className="absolute pointer-events-auto rounded-lg transition-all duration-300 ease-out"
        style={{
          top: `${spotlightPos.top}px`,
          left: `${spotlightPos.left}px`,
          width: `${spotlightPos.width}px`,
          height: `${spotlightPos.height}px`,
          boxShadow: `
            0 0 0 4px rgba(0, 217, 255, 0.3),
            0 0 0 1px rgba(0, 217, 255, 0.5),
            0 0 40px rgba(0, 217, 255, 0.4),
            inset 0 0 0 2px rgba(0, 217, 255, 0.2)
          `,
          animation: "pulse-glow 2s ease-in-out infinite",
        }}
      />
    </>
  );
}
