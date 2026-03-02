import React from "react";
import type { WorkflowPreviewProps } from "../TemplateBrowser.types";

export function WorkflowPreview({
  workflow,
  large = false,
}: WorkflowPreviewProps) {
  const size = large ? 400 : 150;
  const nodeSize = large ? 60 : 20;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="workflow-preview-svg"
    >
      <g className="connections">
        {Object.entries(workflow.connections).map(
          ([sourceId, connections], i) => {
            const source = workflow.actions.find((a) => a.id === sourceId);
            if (!source?.position) return null;

            return connections.main?.map((conns, j) =>
              conns.map((conn, k) => {
                const target = workflow.actions.find(
                  (a) => a.id === conn.action
                );
                if (!target?.position) return null;

                const scale = size / 800;
                const x1 = source.position[0] * scale + nodeSize / 2;
                const y1 = source.position[1] * scale + nodeSize / 2;
                const x2 = target.position[0] * scale + nodeSize / 2;
                const y2 = target.position[1] * scale + nodeSize / 2;

                return (
                  <line
                    key={`${i}-${j}-${k}`}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeWidth={large ? 2 : 1}
                    opacity={0.3}
                  />
                );
              })
            );
          }
        )}
      </g>

      <g className="nodes">
        {workflow.actions.map((action, i) => {
          if (!action.position) return null;
          const scale = size / 800;
          const x = action.position[0] * scale;
          const y = action.position[1] * scale;

          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={nodeSize}
              height={nodeSize}
              fill="currentColor"
              opacity={0.7}
              rx={large ? 4 : 2}
            />
          );
        })}
      </g>
    </svg>
  );
}
